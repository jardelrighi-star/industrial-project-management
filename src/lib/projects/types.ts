/** Existing cadastral model. Budget remains in BRL, without financial migration. */
export type Project = {
  code: string;
  name: string;
  unit: string;
  department: string;
  type: string;
  category: string;
  owner: string;
  manager: string;
  start: string;
  finish: string;
  budget: number;
  priority: string;
  status: string;
  progress: number;
  /** Independent from budget approval; absent on legacy records. */
  executionAuthorization?: {
    status: "pending";
    date: null;
    externalReference: null;
  };
};
