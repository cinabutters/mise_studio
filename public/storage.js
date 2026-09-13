// Validate persisted data before it reaches HTML templates or scheduling code.
// Invalid data is never silently replaced by an empty workspace.
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value);
const string = (value) => typeof value === "string";
const strings = (value) => Array.isArray(value) && value.every(string);
const scalar = (value) =>
  string(value) || (typeof value === "number" && Number.isFinite(value));
const optional = (value, check) => value === undefined || check(value);
function assert(condition) {
  if (!condition) throw new Error("Saved data is not in a supported format.");
}
function recipe(value) {
  assert(
    record(value) &&
      id(value.id) &&
      string(value.title) &&
      scalar(value.servings),
  );
  assert(strings(value.tags) && strings(value.ingredients));
  assert(optional(value.ingredientQuantities, strings));
  assert(
    Array.isArray(value.steps) &&
      value.steps.every(
        (step) => record(step) && string(step.text) && scalar(step.minutes),
      ),
  );
  assert(optional(value.sourceUrl, string));
  assert(
    !value.returnTo ||
      (record(value.returnTo) &&
        id(value.returnTo.projectId) &&
        id(value.returnTo.dishId)),
  );
}
function project(value) {
  assert(
    record(value) &&
      id(value.id) &&
      string(value.name) &&
      Number.isInteger(value.guests) &&
      value.guests >= 1 &&
      value.guests <= 999 &&
      string(value.date),
  );
  assert(Array.isArray(value.courses));
  const ids = new Set();
  for (const course of value.courses) {
    assert(
      record(course) &&
        id(course.id) &&
        !ids.has(course.id) &&
        string(course.name) &&
        string(course.time) &&
        Array.isArray(course.dishes),
    );
    ids.add(course.id);
    for (const dish of course.dishes) {
      assert(
        record(dish) && id(dish.id) && !ids.has(dish.id) && string(dish.name),
      );
      ids.add(dish.id);
      assert(
        !dish.recipe ||
          (record(dish.recipe) &&
            (dish.recipe.provider !== "custom" || id(dish.recipe.id))),
      );
    }
  }
  if (value.ingredientEdits !== undefined) {
    const edits = value.ingredientEdits;
    assert(
      record(edits) && strings(edits.omitted) && Array.isArray(edits.groups),
    );
    assert(
      edits.groups.every(
        (group) => record(group) && id(group.id) && strings(group.keys),
      ),
    );
  }
  if (value.timeline !== undefined) {
    const t = value.timeline;
    assert(
      record(t) &&
        optional(t.zoom, (v) => typeof v === "number" && Number.isFinite(v)),
    );
    assert(
      optional(t.hiddenCourses, strings) && optional(t.hiddenDishes, strings),
    );
    if (t.offsets !== undefined) {
      assert(record(t.offsets));
      for (const [key, entry] of Object.entries(t.offsets))
        assert(
          id(key) &&
            record(entry) &&
            string(entry.signature) &&
            Array.isArray(entry.values) &&
            entry.values.every(
              (v) => typeof v === "number" && Number.isFinite(v),
            ),
        );
    }
  }
}
export function validateWorkspace(data) {
  assert(record(data));
  const result = {};
  for (const [field, validate] of [
    ["projects", project],
    ["recipes", recipe],
    ["drafts", recipe],
  ]) {
    const values = data[field] ?? {};
    assert(record(values));
    result[field] = Object.create(null);
    for (const [key, value] of Object.entries(values)) {
      assert(id(key) && key === value?.id);
      validate(value);
      result[field][key] = value;
    }
  }
  return result;
}
export function loadWorkspace(storage, key) {
  const current = storage.getItem(key);
  if (current !== null) return validateWorkspace(JSON.parse(current));
  const legacy = storage.getItem("mise-studio-projects-v1");
  return validateWorkspace({
    projects: legacy ? JSON.parse(legacy) : {},
    recipes: {},
    drafts: {},
  });
}

export function encodeBackup(workspace) {
  return JSON.stringify({
    format: "mise-studio-workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: validateWorkspace(workspace),
  }, null, 2);
}

export function decodeBackup(text) {
  let backup;
  try { backup = JSON.parse(text); }
  catch { throw new Error("Choose a valid Mise Studio JSON backup."); }
  if (!record(backup) || backup.format !== "mise-studio-workspace" || backup.version !== 1)
    throw new Error("Unsupported backup format or version. Use a Mise Studio version 1 backup.");
  if (!record(backup.workspace) || !["projects", "recipes", "drafts"].every(key => record(backup.workspace[key])))
    throw new Error("The backup is incomplete. Projects, recipes, and drafts are required.");
  return validateWorkspace(backup.workspace);
}
