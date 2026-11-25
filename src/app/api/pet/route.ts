import { hasProjectAccess } from "../../../lib/online/workspace";
import { memoryStorage } from "../../../lib/online/state";
import { LocalStorageProjectRepository } from "../../../lib/projects/repository";
import { commitWorkspace, loadWorkspace, OnlineError, onlineRoute, readRequest, requireMember, response } from "../../../lib/online/server";
import { changePetDocuments, PET_KEY, readPetDocuments, type PetDocument } from "../../../lib/pet/documents";

function visibleDocuments(documents: PetDocument[], userId: string, admin: boolean) {
  return admin ? documents : documents.filter((document) => document.ownerId === userId);
}

export function GET() {
  return onlineRoute(async () => {
    const member = await requireMember();
    const state = await loadWorkspace(member.workspaceId);
    return response(visibleDocuments(readPetDocuments(state.payload[PET_KEY] ?? null), member.userId, member.role === "admin"));
  });
}

export function POST(request: Request) {
  return onlineRoute(async () => {
    const member = await requireMember();
    const input = await readRequest(request);
    const state = await loadWorkspace(member.workspaceId);
    const documents = readPetDocuments(state.payload[PET_KEY] ?? null);
    const admin = member.role === "admin";
    let next: PetDocument[];
    try {
      const projects = input.action === "create"
        ? await new LocalStorageProjectRepository(() => memoryStorage(state.payload)).load()
        : null;
      const projectCodes = new Set(projects?.filter((project) => hasProjectAccess(member, project.code)).map((project) => project.code));
      next = changePetDocuments(documents, input, member.userId, admin, projectCodes);
    } catch (cause) {
      throw new OnlineError(422, cause instanceof Error ? cause.message : "PET inválida.");
    }
    if (next !== documents) {
      await commitWorkspace(member.workspaceId, { ...state, payload: { ...state.payload, [PET_KEY]: JSON.stringify(next) } });
    }
    return response(visibleDocuments(next, member.userId, admin));
  });
}
