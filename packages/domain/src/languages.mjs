export const LANGUAGES = Object.freeze(['python', 'cpp', 'javascript']);
export const JAVASCRIPT_MEMORY_FLOOR_MB = 128;

// The authored limit remains unchanged. Node's startup and syntax-checking
// footprint need this floor for a reliable JavaScript judging contract.
export function effectiveMemoryMb(language, configuredMemoryMb) {
  return language === 'javascript' ? Math.max(configuredMemoryMb, JAVASCRIPT_MEMORY_FLOOR_MB) : configuredMemoryMb;
}

export function languageLimitsFor(version) {
  const configuredMemoryMb = Number(version.memory_limit_mb);
  return {
    python: { effectiveMemoryMb: configuredMemoryMb },
    cpp: { effectiveMemoryMb: configuredMemoryMb },
    javascript: { effectiveMemoryMb: effectiveMemoryMb('javascript', configuredMemoryMb),
      runtimeMemoryFloorMb: JAVASCRIPT_MEMORY_FLOOR_MB },
  };
}

// Stored versions are immutable. Generate defaults at read time so historical
// published Python problems immediately offer the two new language editors.
export function starterCodesFor(version) {
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(version.function_name ?? '') ? version.function_name : 'solve';
  const defaults = version.mode === 'function' ? {
    python: `def ${name}(*args, **kwargs):\n    # Return a JSON-compatible result.\n    pass\n`,
    cpp: `#include <nlohmann/json.hpp>\nusing nlohmann::json;\n\n// args is the JSON positional-argument array; kwargs is a JSON object.\n// Do not modify either input. Return a JSON-compatible value.\njson ${name}(json& args, json& kwargs) {\n    return nullptr;\n}\n`,
    javascript: `function ${name}(...args) {\n  // JSON positional arguments; a nonempty kwargs object is the final argument.\n  return null;\n}\n`,
  } : {
    python: 'import sys\n\ndef main():\n    data = sys.stdin.read()\n    # Write your answer to stdout.\n\nif __name__ == "__main__":\n    main()\n',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Read stdin and write your answer to stdout.\n    return 0;\n}\n',
    javascript: "const fs = require('node:fs');\nconst input = fs.readFileSync(0, 'utf8');\n// Write your answer to stdout.\n",
  };
  const saved = version.starter_codes && typeof version.starter_codes === 'object' && !Array.isArray(version.starter_codes) ? version.starter_codes : {};
  const result = {};
  for (const language of LANGUAGES) result[language] = typeof saved[language] === 'string' && saved[language].trim() ? saved[language]
    : language === 'python' && version.starter_code?.trim() ? version.starter_code : defaults[language];
  return result;
}
