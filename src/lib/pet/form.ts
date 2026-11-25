export type Field = {
  id: string;
  label: string;
  kind: "text" | "date" | "time" | "number" | "textarea" | "choice" | "checks" | "signature" | "people";
  required?: boolean;
  options?: readonly string[];
  when?: readonly [string, string];
};
type Topic = { title: string; fields: Field[]; statement?: string };
const yesNo = ["Sim", "Não"] as const;
const withNA = [...yesNo, "Não se aplica"] as const;
const labels = (prefix: string, names: string[], options: readonly string[] = yesNo): Field[] =>
  names.map((label, index) => ({ id: `${prefix}-${index}`, label, kind: "choice", options, required: true }));
const text = (id: string, label: string, required = false): Field => ({ id, label, kind: "text", required });
const field = (id: string, label: string, kind: Field["kind"], required = true): Field => ({ id, label, kind, required });
const signature = (id: string, label: string, required = true) => field(id, label, "signature", required);
const other = (prefix: string, index: number): Field => ({
  ...field(`${prefix}-other`, "Especifique os outros itens", "textarea"),
  when: [`${prefix}-${index}`, "Sim"],
});
const decision = (id: string, label: string): Field => ({ id, label, kind: "choice", options: yesNo, required: true });
const approvals = (prefix: string) => [
  signature(`${prefix}-requester`, "Requisitante"),
  signature(`${prefix}-approver`, "Aprovador"),
  signature(`${prefix}-coapprover`, "Co-aprovador", false),
];

export const petTopics: Record<number, Topic> = {
  1: { title: "Caracterização do trabalho", fields: [
    text("workOrder", "Nº OS"), text("project", "Nº Projeto"), decision("apr", "APR"),
    ...labels("work", ["A quente", "A frio", "Escavações", "Sistemas elétricos", "Radiografia industrial", "Espaço confinado", "Produtos químicos", "Energia armazenada", "Movimentação de cargas", "Temperaturas extremas", "Trabalho em altura", "Trabalho em área classificada"]),
  ] },
  2: { title: "Requisição", fields: [
    text("requester", "Nome do requisitante", true), text("department", "Setor requisitante", true),
    text("approver", "Nome do aprovador", true), text("location", "Local da atividade", true),
    field("startDate", "Data de início", "date"), field("startTime", "Hora de início", "time"),
    field("validUntilDate", "Data de validade", "date"), field("validUntilTime", "Hora de validade", "time"),
    field("peopleCount", "Quantidade de pessoas", "number"), decision("contracted", "Contratada"),
    { ...text("company", "Nome da empresa contratada", true), when: ["contracted", "Sim"] },
    { ...decision("approvedCompany", "Homologada"), when: ["contracted", "Sim"] },
  ] },
  3: { title: "Descrição", fields: [field("description", "Descrição do trabalho", "textarea")] },
  4: { title: "Características do ambiente de trabalho", fields: [
    ...labels("environment", ["Exposição à chuva", "Piso encharcado", "Trânsito de veículos", "Deficiência de iluminação", "Equipamento energizado", "Presença de pó", "Trânsito de pessoas", "Outros"]), other("environment", 7),
  ] },
  5: { title: "Equipamentos a serem utilizados", fields: [
    ...labels("equipment", ["Solda argônio", "Solda elétrica", "Ferramentas manuais", "Maçarico", "Ferramentas elétricas", "Detector de gás", "Ferramentas isoladas", "Outros", "Detector de tensão", "Escavação mecânica", "Munk / guindaste / plataforma", "Andaimes", "Escada", "Ferramentas antifaiscantes", "Equipamentos elétricos para atmosfera explosiva"]), other("equipment", 7),
  ] },
  6: { title: "Perigos", fields: [
    ...labels("hazard", ["Temperatura baixa", "Calor / partes quentes", "Choque mecânico", "Energia elétrica", "Produtos tóxicos / asfixiantes", "Gases / vapores / poeiras", "Produtos químicos / inflamáveis", "Ar comprimido", "Queda de materiais", "Deficiência de O₂", "Desmoronamento", "Incêndio", "Explosão", "Projeção de partículas", "Radiação", "Partes móveis / rotativas", "Outros"]), other("hazard", 16),
  ] },
  7: { title: "Equipamentos para proteção individual", fields: [
    ...labels("epi", ["Avental PVC", "Conjunto impermeável", "Bota de borracha / PVC", "Luva nitrílica / látex", "Avental de raspa", "Luva de vaqueta", "Máscara para solda", "Protetor facial", "Botina de segurança", "Capacete de segurança", "Protetor auricular", "Óculos de proteção", "Cinto de segurança", "Máscara facial com filtro", "Equipamento autônomo de O₂", "Respirador com filtro", "Luva de borracha", "Uniforme elétrico", "EPI térmico (frio / calor)", "Outros"], ["Sim", "Não se aplica"]),
    { ...text("gloveClass", "Classe da luva de borracha", true), when: ["epi-16", "Sim"] },
    { ...text("uniformClass", "Classe do uniforme elétrico", true), when: ["epi-17", "Sim"] },
    other("epi", 19),
  ] },
  8: { title: "Checklist de liberação de serviços", statement: 'Assinalar “Não” implica uma condição impeditiva para aprovação do trabalho.', fields: [
    ...labels("clearance", [
      "O responsável pela área foi informado?",
      "Foi realizado o isolamento de 11 metros de qualquer material inflamável e/ou combustível no trabalho a quente?",
      "A desenergização foi realizada conforme procedimento do prontuário?",
      "Os bloqueios de energia necessários foram realizados?",
      "Foi feita a drenagem das tubulações e tanques?",
      "A área de trabalho foi isolada e sinalizada?",
      "Foram retirados materiais perigosos ou inflamáveis do local?",
      "Os equipamentos elétricos a serem utilizados em atmosferas explosivas foram bloqueados?",
      "O vigia está presente e existe comunicação eficiente? Os executantes e o vigia de espaço confinado possuem identificação?",
      "A proteção de linhas, dutos e equipamentos foi realizada?",
      "O local para escavação foi analisado ou inspecionado?",
      "Foi definida a destinação correta para os resíduos?",
      "O escoramento foi realizado (escavações)?",
      "Os aterramentos necessários foram feitos?",
      "Os equipamentos dos tópicos 5 e 7 estão adequados para o trabalho?",
      "Os equipamentos de combate a incêndio estão disponíveis no local e o pessoal é capacitado para o uso?",
      "Todos os executantes estão se sentindo bem para realizar o trabalho?",
      "Todos os executantes de trabalho em altura estão com os exames médicos (ASO) em dia?",
      "Outros",
    ], withNA),
    { ...field("energyLocks", "Tipos de bloqueio de energia", "checks"), options: ["Elétrica", "Química", "Cinética", "Térmica", "Fontes radioativas", "Pressão"], when: ["clearance-3", "Sim"] },
    other("clearance", 18),
  ] },
  9: { title: "Medições em espaço confinado", fields: [
    { ...field("calibration", "Data de calibração do equipamento", "date"), when: ["work-5", "Sim"] },
    ...["Oxigênio (%)", "Explosividade (% LEL)", "CO (ppm)", "H₂S (ppm)"].flatMap((label, row) =>
      ["Inicial", "Med 1", "Med 2", "Med 3", "Med 4"].map((column, index): Field => ({
        ...text(`measure-${row}-${index}`, `${label} · ${column}`, index === 0), when: ["work-5", "Sim"],
      }))),
    { ...decision("ventilation", "Necessidade de ventilação"), when: ["work-5", "Sim"] },
    { ...signature("supervisor", "Supervisor de espaço confinado"), when: ["work-5", "Sim"] },
  ] },
  10: { title: "Termo de responsabilidade de execução do trabalho", statement: "Declaro que realizarei todas as medidas de controle descritas nesta PET, assim como providenciarei todos os equipamentos de proteção necessários para a realização deste serviço e comprometo-me a realizar a correta utilização dos mesmos. Declaro também que me encontro apto para realizar o trabalho.", fields: [decision("responsibility", "Confirmação do termo")] },
  11: { title: "Assinaturas dos executantes e vigias", fields: [
    field("workers", "Executantes", "people"),
    { ...field("watchers", "Vigias", "people"), when: ["work-5", "Sim"] },
  ] },
  12: { title: "Autorização", statement: "Após ter avaliado os riscos inerentes ao trabalho a ser realizado, estou ciente de minha responsabilidade e autorizo sua execução seguindo as medidas de controle nesta PET e acordadas com os executantes e vigias.", fields: [decision("authorization", "Confirmação da autorização")] },
  13: { title: "Aprovação", fields: [...approvals("approval"), field("notes", "Observações", "textarea", false)] },
  14: { title: "Encerramento", fields: [
    field("endDate", "Data de fim", "date"), field("endTime", "Hora de fim", "time"),
    decision("clean", "Área limpa e organizada"), ...approvals("closure"),
  ] },
  15: { title: "Cancelamento", fields: [
    decision("cancelled", "PET cancelada"), { ...field("cancellationReason", "Motivo", "textarea"), when: ["cancelled", "Sim"] },
  ] },
  16: { title: "Reinspeção após o término do trabalho a quente", fields: labels("inspection",
    ["30 minutos", "1 hora", "1,5 hora", "2 horas"].map((time) => `Foi realizada a supervisão da área após ${time} do serviço?`), withNA)
    .map((item) => ({ ...item, when: ["work-0", "Sim"] })) },
};
