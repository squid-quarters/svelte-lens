import { createSourceResolver, svelteResolver, type ElementSourceInfo } from "element-source";
import type { ElementContext, SourceInfo } from "../types.js";
import { DEFAULT_MAX_CONTEXT_LINES } from "../constants.js";
import { formatHtmlPreview } from "../utils/format-html-preview.js";
import { formatStackString } from "../utils/format-stack-string.js";
import { getTagName } from "../utils/get-tag-name.js";

const resolver = createSourceResolver({ resolvers: [svelteResolver] });

const componentNameFromFilePath = (filePath: string): string | null => {
  const match = filePath.match(/([^/\\]+)\.svelte$/);
  return match?.[1] ?? null;
};

const fillComponentName = (frame: ElementSourceInfo): SourceInfo => ({
  filePath: frame.filePath,
  lineNumber: frame.lineNumber,
  columnNumber: frame.columnNumber,
  componentName: frame.componentName ?? componentNameFromFilePath(frame.filePath),
});

// SvelteKit renders route files (+page, +layout, +error) through a dynamic
// component in its own root, so the tag naming them is a variable such as
// "Component". Name them after the file instead.
const isRouteFile = (filePath: string): boolean => /(^|[/\\])\+[^/\\]+\.svelte$/.test(filePath);

// Frames inside dependencies or SvelteKit's generated code (its root
// component) say nothing about the app and crowd app frames out of the
// copied stack.
const isFrameworkFrame = (frame: ElementSourceInfo): boolean =>
  /(^|[/\\])(node_modules|\.svelte-kit)[/\\]/.test(frame.filePath);

export const resolveStack = async (element: Element): Promise<SourceInfo[]> => {
  const [first, ...rest] = await resolver.resolveStack(element);
  if (!first) return [];
  // The first frame is where the element itself is written; keep it even in a
  // dependency so a library component still resolves to its source.
  const own = fillComponentName(first);
  if (isRouteFile(first.filePath)) own.componentName = componentNameFromFilePath(first.filePath);
  return [own, ...rest.filter((frame) => !isFrameworkFrame(frame)).map(fillComponentName)];
};

export const resolveSource = async (element: Element): Promise<SourceInfo | null> =>
  (await resolveStack(element))[0] ?? null;

export const getStackContext = async (
  element: Element,
  maxLines = DEFAULT_MAX_CONTEXT_LINES,
): Promise<string> => {
  const stack = await resolveStack(element);
  return formatStackString(stack, maxLines);
};

export const getElementContext = async (element: Element): Promise<ElementContext> => {
  const [source, stack] = await Promise.all([resolveSource(element), resolveStack(element)]);
  return {
    element,
    tagName: getTagName(element),
    componentName: source?.componentName ?? stack[0]?.componentName ?? null,
    source,
    stack,
    htmlPreview: formatHtmlPreview(element),
    stackString: formatStackString(stack),
  };
};
