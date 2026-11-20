import type { Project } from "./types";

/** Validate storage shape without normalizing codes, dropping fields or imposing new business rules on legacy records. */
export function validateProjects(value: unknown): asserts value is Project[] {
  if (!Array.isArray(value)) throw new Error("O cadastro de projetos deve ser uma lista.");
  const textFields = ["code", "name", "unit", "department", "type", "category", "owner", "manager", "start", "finish", "priority", "status"] as const;
  const codes = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Registro de projeto inválido.");
    for (const field of textFields) {
      if (typeof item[field] !== "string") throw new Error(`Campo cadastral inválido: ${field}.`);
    }
    for (const field of ["budget", "progress"] as const) {
      if (typeof item[field] !== "number" || !Number.isFinite(item[field])) throw new Error(`Campo numérico inválido: ${field}.`);
    }
    if (!item.code.trim() || codes.has(item.code)) throw new Error("Código de projeto ausente ou duplicado.");
    codes.add(item.code);
    if (item.executionAuthorization !== undefined) {
      const approval = item.executionAuthorization;
      if (!approval || typeof approval !== "object" || approval.status !== "pending" || approval.date !== null || approval.externalReference !== null) throw new Error("Autorização de execução inválida.");
    }
  }
}

function validDate(value: string) {
  return !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
}

/** Form rules apply only to the record being saved, leaving other legacy records untouched. */
export function prepareProject(form: Project, projects: readonly Project[], editingCode: string | null): Project {
  if (!form.code.trim() || !form.name.trim()) throw new Error("Preencha o código e o nome do projeto.");
  validateProjects([form]);
  if (editingCode !== null && (!projects.some((p) => p.code === editingCode) || form.code !== editingCode)) {
    throw new Error("O código de um projeto existente não pode ser alterado.");
  }
  if (editingCode !== null && form.budget !== projects.find((p) => p.code === editingCode)!.budget) {
    throw new Error("O orçamento legado é somente leitura. Utilize a reconciliação financeira.");
  }
  if (editingCode === null && form.budget !== 0) throw new Error("Cadastre o orçamento aprovado pela reconciliação financeira.");
  const code = editingCode ?? form.code.trim().toUpperCase();
  if (projects.some((p) => p.code.toUpperCase() === code.toUpperCase() && p.code !== editingCode)) throw new Error("Este código já está cadastrado.");
  if (!validDate(form.start) || !validDate(form.finish)) throw new Error("Informe datas cadastrais válidas.");
  if (form.finish && form.start && form.finish < form.start) throw new Error("A data final não pode ser anterior à inicial.");
  if (form.budget < 0) throw new Error("O orçamento não pode ser negativo.");
  if (form.progress < 0 || form.progress > 100) throw new Error("O avanço físico deve estar entre 0 e 100.");
  return { ...form, code, name: form.name.trim() };
}
