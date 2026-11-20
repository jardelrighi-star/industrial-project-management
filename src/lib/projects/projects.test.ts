import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LocalStorageProjectRepository, PROJECTS_STORAGE_KEY } from "./repository";
import { prepareProject, validateProjects } from "./validation";
import type { Project } from "./types";

const legacy: Project = {
  code: "cap-001", name: "Projeto legado", unit: "Unidade Industrial", department: "Engenharia",
  type: "CAPEX", category: "Segurança", owner: "Responsável", manager: "Gerente",
  start: "2026-01-01", finish: "2026-12-31", budget: 1234.56, priority: "Alta", status: "Em andamento", progress: 35,
};

function storage(initial?: string) {
  const entries = new Map<string, string>();
  if (initial !== undefined) entries.set(PROJECTS_STORAGE_KEY, initial);
  entries.set("industrial-project-finance:v1", "financial snapshot unchanged");
  let writes = 0;
  const repository = new LocalStorageProjectRepository(() => ({
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { writes++; entries.set(key, value); },
  }));
  return { repository, entries, writes: () => writes };
}

test("missing key and an explicitly empty portfolio are distinct, with no automatic seeding", async () => {
  const missing = storage();
  assert.equal(await missing.repository.load(), null);
  assert.equal(missing.writes(), 0);
  assert.equal(missing.entries.has(PROJECTS_STORAGE_KEY), false);
  const empty = storage("[]");
  assert.deepEqual(await empty.repository.load(), []);
  assert.equal(empty.writes(), 0);
});

test("legacy array loads verbatim without rewriting codes, fields or storage", async () => {
  const value = [{ ...legacy, customMetadata: { reference: "external", tags: ["legacy"] } }];
  const raw = JSON.stringify(value, null, 2);
  const s = storage(raw);
  assert.deepEqual(await s.repository.load(), value);
  assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), raw);
  assert.equal(s.writes(), 0);
});

test("explicit saves preserve the legacy array format, monetary units and additional fields", async () => {
  const value = [{ ...legacy, historicalField: "preserve" }];
  const s = storage(JSON.stringify(value));
  const loaded = (await s.repository.load())!;
  const updated = prepareProject({ ...loaded[0], name: "Novo nome" }, loaded, legacy.code);
  await s.repository.save([updated]);
  assert.equal(s.writes(), 1);
  assert.deepEqual(await s.repository.load(), [{ ...value[0], name: "Novo nome" }]);
  assert.equal(s.entries.get("industrial-project-finance:v1"), "financial snapshot unchanged");
  assert.equal(updated.code, "cap-001");
  assert.equal(updated.budget, 1234.56);
});

test("creation, editing and deletion can be explicitly persisted without reseeding empty storage", async () => {
  const s = storage();
  const created = prepareProject({ ...legacy, code: "NEW-01", budget: 0 }, [], null);
  await s.repository.save([created]);
  assert.deepEqual(await s.repository.load(), [created]);
  await s.repository.save([{ ...created, progress: 50 }]);
  assert.equal((await s.repository.load())![0].progress, 50);
  await s.repository.save([]);
  assert.deepEqual(await s.repository.load(), []);
  assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), "[]");
});

test("malformed JSON and unsupported shapes fail without replacing stored bytes", async () => {
  for (const raw of ["", "{broken", "null", "{}", '[{"code":"P1"}]', JSON.stringify([{ ...legacy, budget: "123" }]), JSON.stringify([legacy, legacy])]) {
    const s = storage(raw);
    await assert.rejects(s.repository.load(), /dados armazenados foram preservados/);
    await assert.rejects(s.repository.save([legacy]), /alteração não foi aplicada/);
    assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), raw);
    assert.equal(s.writes(), 0);
  }
});

test("save refuses corrupted storage even after a successful initial read", async () => {
  const s = storage(JSON.stringify([legacy]));
  await s.repository.load();
  s.entries.set(PROJECTS_STORAGE_KEY, "broken after load");
  await assert.rejects(s.repository.save([{ ...legacy, name: "Changed" }]), /salvar/);
  assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), "broken after load");
  assert.equal(s.writes(), 0);
});

test("invalid save payloads do not overwrite a valid portfolio", async () => {
  const raw = JSON.stringify([legacy]);
  const s = storage(raw);
  await assert.rejects(s.repository.save([{ ...legacy, budget: NaN }]), /salvar/);
  assert.equal(s.entries.get(PROJECTS_STORAGE_KEY), raw);
  assert.equal(s.writes(), 0);
});

test("storage provider and getItem errors are reported without writes", async () => {
  const unavailable = new LocalStorageProjectRepository(() => { throw new Error("Storage unavailable"); });
  await assert.rejects(unavailable.load(), /ler o cadastro/);
  await assert.rejects(unavailable.save([legacy]), /salvar o cadastro/);
  let writes = 0;
  const readFailure = new LocalStorageProjectRepository(() => ({
    getItem: () => { throw new Error("Access denied"); },
    setItem: () => { writes++; },
  }));
  await assert.rejects(readFailure.load(), /ler o cadastro/);
  await assert.rejects(readFailure.save([legacy]), /salvar o cadastro/);
  assert.equal(writes, 0);
});

test("quota errors propagate and retain the previous saved portfolio", async () => {
  const raw = JSON.stringify([legacy]);
  const repository = new LocalStorageProjectRepository(() => ({
    getItem: (key) => key === PROJECTS_STORAGE_KEY ? raw : null,
    setItem: () => { throw new Error("QuotaExceededError"); },
  }));
  await assert.rejects(repository.save([{ ...legacy, name: "Unsaved" }]), /alteração não foi aplicada/);
  assert.deepEqual(await repository.load(), [legacy]);
});

test("form rules preserve existing codes and reject changes, duplicate codes and invalid dates", () => {
  assert.equal(prepareProject({ ...legacy, name: " Editado " }, [legacy], legacy.code).code, legacy.code);
  assert.throws(() => prepareProject({ ...legacy, code: "CAP-001" }, [legacy], legacy.code), /não pode ser alterado/);
  assert.throws(() => prepareProject({ ...legacy, code: "CAP-001", budget: 0 }, [legacy], null), /já está cadastrado/);
  assert.throws(() => prepareProject({ ...legacy, code: "" }, [], null), /código e o nome/);
  assert.throws(() => prepareProject({ ...legacy, name: " " }, [], null), /código e o nome/);
  assert.throws(() => prepareProject({ ...legacy, finish: "2025-01-01" }, [legacy], legacy.code), /anterior/);
  assert.throws(() => prepareProject({ ...legacy, start: "2026-02-30" }, [legacy], legacy.code), /datas/);
  assert.throws(() => prepareProject({ ...legacy, progress: 101 }, [legacy], legacy.code), /avanço/);
  assert.throws(() => prepareProject({ ...legacy, budget: -1 }, [legacy], legacy.code), /somente leitura/);
});

test("storage validation accepts legacy labels and values without domain migrations", () => {
  const value = [{ ...legacy, type: "Tipo antigo", status: "Status antigo", priority: "", start: "", finish: "" }];
  validateProjects(value);
  assert.equal(value[0].code, legacy.code);
  assert.equal(value[0].status, "Status antigo");
});
