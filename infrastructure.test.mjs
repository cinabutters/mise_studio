import assert from "node:assert/strict";
import { createAppServer } from "./server.mjs";
import { validateWorkspace, loadWorkspace } from "./public/storage.js";
import { once } from "node:events";
const server = createAppServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
try {
  const legacyRoute = await fetch(base + "/recipe/edit/test?timeline=project", {redirect:"manual"});
  assert.equal(legacyRoute.status, 302);
  assert.equal(legacyRoute.headers.get("location"), "/#/recipe/edit/test?timeline=project");
  for (const path of [
    "/",
    "/recipes",
    "/project/test",
    "/recipe/new/test",
    "/recipe/edit/test",
    "/app.js",
    "/timeline-model.js",
    "/storage.js",
    "/style.css",
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.ok(body.length);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      res.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    const head = await fetch(base + path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("content-length"),
      res.headers.get("content-length"),
    );
    const cached = await fetch(base + path, {
      headers: { "If-None-Match": res.headers.get("etag") },
    });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
  }
  const compressed = await fetch(base + "/app.js", {
    headers: { "Accept-Encoding": "gzip" },
  });
  const plain = await fetch(base + "/app.js", {
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.ok(
    Number(compressed.headers.get("content-length")) <
      Number(plain.headers.get("content-length")),
  );
  assert.equal(await compressed.text(), await plain.text());
  for (const path of [
    "/.env",
    "/server.mjs",
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/missing",
    "/api/import-recipe",
    "/api/recipes",
  ])
    assert.equal((await fetch(base + path)).status, 404, path);
  const post = await fetch(base + "/", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
} finally {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
}
const good = {
  projects: {
    p: { id: "p", name: "Dinner", guests: 4, date: "2026-09-07", courses: [] },
  },
  recipes: {},
  drafts: {},
};
assert.equal(validateWorkspace(good).projects.p.name, "Dinner");
assert.equal(Object.getPrototypeOf(validateWorkspace(good).projects), null);
assert.throws(() => validateWorkspace({ projects: [] }));
assert.throws(() =>
  validateWorkspace({
    projects: { p: { ...good.projects.p, guests: '"><img src=x>' } },
  }),
);
assert.throws(() =>
  validateWorkspace({
    projects: {
      p: {
        ...good.projects.p,
        courses: [{ id: 'bad"id', name: "", time: "", dishes: [] }],
      },
    },
  }),
);
assert.equal(
  loadWorkspace(
    {
      getItem: (k) =>
        k === "mise-studio-projects-v1" ? JSON.stringify(good.projects) : null,
    },
    "current",
  ).projects.p.name,
  "Dinner",
);
assert.throws(() => loadWorkspace({ getItem: () => "{invalid" }, "current"));
console.log(
  "PASS: production HTTP routes, HEAD, conditional caching, security headers, private-file denial, removed endpoints, method handling, legacy storage migration, schema validation and safe record maps.",
);
