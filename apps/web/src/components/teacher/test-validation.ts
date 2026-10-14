import { jsonValue, validateFunctionInput } from "../../lib/function-input.ts";

export { jsonValue };

export function validateFunctionCase(input: string, expected: string): void {
  validateFunctionInput(input);
  jsonValue(expected);
}
