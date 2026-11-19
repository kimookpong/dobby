import { ModelLibrary } from "../electron/models";
import { homedir } from "node:os";
import { join } from "node:path";
const get = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const source = get("--models");
if (!source) throw new Error("Pass --models with your Live2D model folder");
const library = new ModelLibrary(
  get("--data") ?? join(homedir(), "Library", "Application Support", "Dobby"),
);
await library.load();
const imported = await library.importPath(source);
if (get("--core")) await library.importCore(get("--core")!);
const select = get("--select"),
  state = library.state("http://127.0.0.1", "local");
const selected = state.models.find((model) => model.name === select);
if (selected) await library.select(selected.id);
console.log(
  JSON.stringify(
    {
      imported: imported.imported,
      errors: imported.errors,
      selected:
        selected?.name ??
        state.models.find((model) => model.id === state.selectedId)?.name,
      models: state.models.map((model) => ({
        name: model.name,
        motions: model.motions.length,
        expressions: model.expressions.length,
      })),
    },
    null,
    2,
  ),
);
