import { libraryTools } from "./library-tools"
import { pageTools } from "./page-tools"
import { tabTools } from "./tab-tools"
import { workflowTools } from "./workflow-tools"

export const browserTools = [
  ...tabTools,
  ...libraryTools,
  ...pageTools,
  ...workflowTools(() => browserTools)
]
export const browserToolSpecs = browserTools.map((t) => t.spec)
export const browserToolHandlers = Object.fromEntries(
  browserTools.map((t) => [t.spec.name, t.run])
)
