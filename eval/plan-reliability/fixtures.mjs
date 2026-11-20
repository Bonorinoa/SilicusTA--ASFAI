/** Twelve original stand-ins for the plan reliability gate. No private source text is copied here. */
const objectives = (topic, count) => Array.from({ length: count }, (_, i) => `Students can ${topic} (${i + 1}).`);
const names = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}.txt`);

export const FIXTURES = Object.freeze([
  {
    id: "short-stage-1", title: "Neighborhood shadows", ages: { min: 5, max: 7 }, lessonMinutes: 30,
    materials: ["shadow-note.txt"], objectives: ["Students can point to a shadow and name the object that blocks the light."],
    tags: ["short", "age-stage-1"],
  },
  {
    id: "many-sources-stage-2", title: "How a town saves water", ages: { min: 8, max: 11 }, lessonMinutes: 50,
    materials: names("water-source", 16), objectives: objectives("compare one household and one community water-saving choice", 8),
    tags: ["long-many-sources", "age-stage-2"],
  },
  {
    id: "fifty-objectives-stage-3", title: "Fifty views of an ecosystem", ages: { min: 12, max: 14 }, lessonMinutes: 60,
    materials: ["ecosystem-overview.txt"], objectives: objectives("explain one numbered relationship in a food web", 50),
    tags: ["fifty-objectives", "age-stage-3"],
  },
  {
    id: "spanish-source-stage-4", title: "Datos y decisiones públicas", ages: { min: 15, max: 17 }, lessonMinutes: 55,
    materials: ["fuente-en-espanol.txt"],
    objectives: ["El alumnado puede distinguir una tasa de un conteo.", "El alumnado puede explicar una comparación con palabras sencillas."],
    tags: ["non-english-source", "age-stage-4"],
  },
  {
    id: "adult-18-plus", title: "Reading policy evidence", ages: { min: 18, max: 24 }, lessonMinutes: 75,
    materials: ["policy-table.txt"], objectives: objectives("interpret one uncertainty interval without claiming certainty", 4),
    tags: ["age-18-plus"],
  },
  {
    id: "unknown-ages", title: "Introduction to feedback loops", ages: null, lessonMinutes: 45,
    materials: ["feedback-loop.txt"], objectives: objectives("trace one reinforcing or balancing loop", 3),
    tags: ["age-unknown"],
  },
  {
    id: "l2-hard-adult-stand-in", title: "Causal diagrams for a graduate workshop", ages: { min: 22, max: 30 }, lessonMinutes: 45,
    materials: ["causal-diagram-primer.txt"], objectives: objectives("identify a confounder in a small causal diagram", 6),
    tags: ["l2-hard-adult"],
  },
  {
    id: "l2-hard-under-18-stand-in", title: "Leaves, light, and stored energy", ages: { min: 10, max: 11 }, lessonMinutes: 45,
    materials: ["leaf-energy-notes.txt"], objectives: objectives("explain one step linking light to stored energy in a leaf", 6),
    tags: ["l2-hard-under-18"],
  },
  {
    id: "stage-1-boundary", title: "Sorting sounds", ages: { min: 7, max: 8 }, lessonMinutes: 35,
    materials: ["sound-cards.txt"], objectives: objectives("sort a sound by a visible property of its source", 3),
    tags: ["age-stage-1"],
  },
  {
    id: "stage-2-boundary-empty-retry", title: "Maps and scale", ages: { min: 8, max: 11 }, lessonMinutes: 45,
    materials: ["map-scale.txt"], objectives: objectives("use a map scale to compare two distances", 4),
    tags: ["age-stage-2"],
  },
  {
    id: "stage-3-boundary", title: "Claims and counterexamples", ages: { min: 14, max: 14 }, lessonMinutes: 40,
    materials: ["claims.txt"], objectives: objectives("test a broad claim with a counterexample", 4),
    tags: ["age-stage-3"],
  },
  {
    id: "stage-4-wide", title: "Budget choices across a lifetime", ages: { min: 15, max: 99 }, lessonMinutes: 90,
    materials: ["budget-scenarios.txt"], objectives: objectives("compare two budget choices under a stated constraint", 5),
    tags: ["age-stage-4"],
  },
]);
