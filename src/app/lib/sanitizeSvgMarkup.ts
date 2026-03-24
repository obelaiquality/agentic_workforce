const EVENT_HANDLER_ATTR = /\son[a-z-]+\s*=\s*(['"]).*?\1/gi;
const SCRIPT_TAG = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const JS_URL_ATTR = /\s(?:href|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi;

export function sanitizeSvgMarkup(input: string) {
  return input
    .replace(SCRIPT_TAG, "")
    .replace(EVENT_HANDLER_ATTR, "")
    .replace(JS_URL_ATTR, "");
}
