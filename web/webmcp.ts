import { api } from "./lib";
type Registry = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void;
};
export function registerSearch() {
  const context = (document as Document & { modelContext?: Registry })
    .modelContext;
  if (!context?.registerTool) return;
  const life = new AbortController();
  try {
    context.registerTool(
      {
        name: "search_planete_community",
        title: "Rechercher dans la communauté",
        description:
          "Recherche les profils visibles pour le compte connecté. Lecture seule, avec les mêmes règles de confidentialité que l’interface.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", maxLength: 100 } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input) => {
          if (
            !input ||
            typeof input !== "object" ||
            !("query" in input) ||
            typeof input.query !== "string" ||
            input.query.length > 100
          )
            throw new Error("Recherche invalide.");
          return api(`/users?q=${encodeURIComponent(input.query)}`);
        },
      },
      { signal: life.signal },
    );
  } catch {
    life.abort();
  }
  window.addEventListener("pagehide", () => life.abort(), { once: true });
}
