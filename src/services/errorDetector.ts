import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ParsedError {
  type: ErrorType;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  code?: string;
  rule?: string;
  framework?: string;
  suggestion?: string;
  fullOutput: string;
  relatedErrors?: ParsedError[];
}

export type ErrorType = 
  // JavaScript/TypeScript
  | 'typescript' | 'javascript' | 'eslint' | 'prettier'
  // React ecosystem
  | 'react' | 'next' | 'gatsby' | 'remix'
  // Vue ecosystem  
  | 'vue' | 'nuxt' | 'vite'
  // Mobile
  | 'react-native' | 'expo' | 'flutter' | 'swift' | 'kotlin' | 'android' | 'ios' | 'xcode' | 'gradle'
  // Build tools
  | 'webpack' | 'rollup' | 'esbuild' | 'parcel' | 'turbopack'
  // CSS/Styling
  | 'css' | 'sass' | 'less' | 'tailwind' | 'postcss' | 'styled-components'
  // Testing
  | 'jest' | 'vitest' | 'mocha' | 'cypress' | 'playwright' | 'detox'
  // Runtime
  | 'runtime' | 'syntax' | 'module' | 'network' | 'memory'
  // Package managers
  | 'npm' | 'yarn' | 'pnpm' | 'cocoapods' | 'pub'
  // General
  | 'build' | 'lint' | 'unknown';

export interface ErrorContext {
  fileContent?: string;
  surroundingLines?: string[];
  imports?: string[];
  exports?: string[];
  dependencies?: Record<string, string>;
  stackTrace?: string[];
  previousFixes?: string[];
}

interface ErrorPattern {
  type: ErrorType;
  framework?: string;
  patterns: RegExp[];
  extractor: (match: RegExpMatchArray, output: string) => Partial<ParsedError>;
  severity?: 'error' | 'warning' | 'info';
}

// Comprehensive error patterns for web and mobile development
const ERROR_PATTERNS: ErrorPattern[] = [
  // ==================== TYPESCRIPT/JAVASCRIPT ====================
  {
    type: 'typescript',
    patterns: [
      /([^\s()]+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g,
      /([^\s]+\.tsx?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)/g,
      /error\s+(TS\d+):\s*(.+)\s+at\s+([^\s]+):(\d+):(\d+)/g,
    ],
    extractor: (match) => ({
      file: match[1] || match[3],
      line: parseInt(match[2] || match[4]),
      column: parseInt(match[3] || match[5]),
      code: match[4] || match[1],
      message: match[5] || match[2],
    }),
  },
  {
    type: 'javascript',
    patterns: [
      /([^\s]+\.jsx?):(\d+):?(\d+)?\s*[-–]\s*(.+)/g,
      /at\s+([^\s]+)\s+\(([^\s]+\.jsx?):(\d+):(\d+)\)/g,
    ],
    extractor: (match) => ({
      file: match[1] || match[2],
      line: parseInt(match[2] || match[3]),
      column: match[3] ? parseInt(match[3]) : undefined,
      message: match[4] || `Error at ${match[1]}`,
    }),
  },

  // ==================== ESLINT ====================
  {
    type: 'eslint',
    patterns: [
      /([^\s]+):(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([\w\/@-]+)$/gm,
      /\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([\w\/@-]+)$/gm,
    ],
    extractor: (match) => ({
      file: match[1]?.includes(':') ? undefined : match[1],
      line: parseInt(match[1]?.includes(':') ? match[1] : match[2]),
      column: parseInt(match[2]?.includes(':') ? match[2] : match[3]),
      severity: (match[3] === 'warning' || match[4] === 'warning') ? 'warning' : 'error',
      message: match[4] || match[5],
      rule: match[5] || match[6],
    }),
  },

  // ==================== REACT ====================
  {
    type: 'react',
    framework: 'react',
    patterns: [
      /Warning:\s*(.+?)\s*(?:in|at)\s+(\w+)\s*\((?:at\s+)?([^\s)]+):(\d+):?(\d+)?\)/g,
      /Error:\s*(.+?)\s*(?:in|at)\s+(\w+)/g,
      /Invalid hook call/g,
      /Cannot update a component .* while rendering a different component/g,
      /Each child in a list should have a unique "key" prop/g,
      /React Hook .* is called conditionally/g,
      /React Hook .* has a missing dependency/g,
      /Cannot read propert(?:y|ies) of (undefined|null)/g,
    ],
    extractor: (match, output) => ({
      message: match[1] || match[0],
      file: match[3],
      line: match[4] ? parseInt(match[4]) : undefined,
      suggestion: getReactSuggestion(match[0]),
    }),
  },

  // ==================== NEXT.JS ====================
  {
    type: 'next',
    framework: 'next',
    patterns: [
      /Error:\s*(.+)\s*at\s+([^\s]+)\s*\(([^\s]+):(\d+):(\d+)\)/g,
      /Server Error\s*\n\s*(.+)/g,
      /Unhandled Runtime Error\s*\n\s*(.+)/g,
      /Module not found: Can't resolve '([^']+)'/g,
      /You're importing a component that needs (?:useState|useEffect|useContext)/g,
      /'use client' directive/g,
      /Image with src "([^"]+)" must use "width" and "height"/g,
      /next\/image.*requires.*loader/g,
      /getServerSideProps.*getStaticProps.*cannot be used together/g,
      /Hydration failed because/g,
    ],
    extractor: (match, output) => ({
      message: match[1] || match[0],
      file: match[3] || extractFileFromOutput(output),
      line: match[4] ? parseInt(match[4]) : undefined,
      suggestion: getNextJsSuggestion(match[0]),
    }),
  },

  // ==================== VUE ====================
  {
    type: 'vue',
    framework: 'vue',
    patterns: [
      /\[Vue warn\]:\s*(.+)/g,
      /\[Vue error\]:\s*(.+)/g,
      /Template compilation error:\s*(.+)/g,
      /Component.*is missing template/g,
      /Property.*was accessed during render but is not defined/g,
      /Avoid mutating a prop directly/g,
      /v-model.*cannot be used on a prop/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getVueSuggestion(match[0]),
    }),
  },

  // ==================== VITE ====================
  {
    type: 'vite',
    framework: 'vite',
    patterns: [
      /\[vite\]:\s*(.+)/g,
      /Pre-transform error:\s*(.+)/g,
      /Failed to resolve import "([^"]+)"/g,
      /Rollup failed to resolve import/g,
      /ENOENT.*vite\.config/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },

  // ==================== REACT NATIVE ====================
  {
    type: 'react-native',
    framework: 'react-native',
    patterns: [
      /ERROR\s+(.+)/g,
      /WARN\s+(.+)/g,
      /Unable to resolve module ([^\s]+)/g,
      /Invariant Violation:\s*(.+)/g,
      /Native module .* tried to override/g,
      /requireNativeComponent.*was not found/g,
      /ViewPropTypes will be removed/g,
      /RCT.*module.*not available/g,
      /Pod install.*failed/g,
      /Metro bundler.*error/gi,
      /Unable to load script.*Make sure you're/gi,
      /Could not connect to development server/g,
      /Application.*has not been registered/g,
    ],
    extractor: (match, output) => ({
      message: match[1] || match[0],
      suggestion: getReactNativeSuggestion(match[0]),
    }),
  },

  // ==================== EXPO ====================
  {
    type: 'expo',
    framework: 'expo',
    patterns: [
      /expo.*error/gi,
      /Unable to resolve "([^"]+)" from/g,
      /This project is not configured to support/g,
      /expo-.*not.*installed/gi,
      /Expo SDK.*requires.*version/g,
      /Cannot determine which native SDK version your project uses/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getExpoSuggestion(match[0]),
    }),
  },

  // ==================== FLUTTER ====================
  {
    type: 'flutter',
    framework: 'flutter',
    patterns: [
      /Error:\s*(.+)\s*at\s*([^\s]+):(\d+):(\d+)/g,
      /\[ERROR:flutter\/.*\]\s*(.+)/g,
      /The following.*error was thrown/g,
      /A RenderFlex overflowed/g,
      /setState\(\) called after dispose/g,
      /NoSuchMethodError:\s*(.+)/g,
      /Null check operator used on a null value/g,
      /type '(.+)' is not a subtype of type '(.+)'/g,
      /pub get failed/gi,
      /Could not find.*in any of the sources/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      file: match[2],
      line: match[3] ? parseInt(match[3]) : undefined,
      suggestion: getFlutterSuggestion(match[0]),
    }),
  },

  // ==================== SWIFT/IOS ====================
  {
    type: 'swift',
    framework: 'ios',
    patterns: [
      /([^\s]+\.swift):(\d+):(\d+):\s*(error|warning):\s*(.+)/g,
      /error:\s*(.+)/g,
      /Cannot find '(\w+)' in scope/g,
      /Value of type '(.+)' has no member '(.+)'/g,
      /Type '(.+)' does not conform to protocol '(.+)'/g,
      /Initializer.*cannot be used/g,
      /Missing argument.*in call/g,
    ],
    extractor: (match) => ({
      file: match[1],
      line: match[2] ? parseInt(match[2]) : undefined,
      column: match[3] ? parseInt(match[3]) : undefined,
      severity: match[4] === 'warning' ? 'warning' : 'error',
      message: match[5] || match[1] || match[0],
    }),
  },

  // ==================== XCODE ====================
  {
    type: 'xcode',
    framework: 'ios',
    patterns: [
      /xcodebuild.*error/gi,
      /Build Failed/g,
      /Signing.*requires/g,
      /No provisioning profiles/g,
      /Signing certificate.*not found/g,
      /SDK "(.+)" cannot be located/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getXcodeSuggestion(match[0]),
    }),
  },

  // ==================== KOTLIN/ANDROID ====================
  {
    type: 'kotlin',
    framework: 'android',
    patterns: [
      /e:\s*([^\s]+):(\d+):(\d+):\s*(.+)/g,
      /error:\s*(.+)/g,
      /Unresolved reference:\s*(\w+)/g,
      /Type mismatch:\s*(.+)/g,
      /Overload resolution ambiguity/g,
      /'(\w+)' is deprecated/g,
    ],
    extractor: (match) => ({
      file: match[1],
      line: match[2] ? parseInt(match[2]) : undefined,
      column: match[3] ? parseInt(match[3]) : undefined,
      message: match[4] || match[1] || match[0],
    }),
  },

  // ==================== GRADLE/ANDROID ====================
  {
    type: 'gradle',
    framework: 'android',
    patterns: [
      /FAILURE:\s*(.+)/g,
      /BUILD FAILED/g,
      /Could not resolve.*dependencies/g,
      /SDK location not found/g,
      /Failed to find target.*SDK/g,
      /Execution failed for task ':app:(.+)'/g,
      /Manifest merger failed/g,
      /Duplicate class/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getGradleSuggestion(match[0]),
    }),
  },

  // ==================== WEBPACK ====================
  {
    type: 'webpack',
    patterns: [
      /Module build failed.*:\s*(.+)/g,
      /ModuleNotFoundError:\s*(.+)/g,
      /Module parse failed:\s*(.+)/g,
      /ERROR in (.+)/g,
      /Can't resolve '([^']+)'/g,
      /Invalid configuration object/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },

  // ==================== CSS/STYLING ====================
  {
    type: 'css',
    patterns: [
      /CssSyntaxError:\s*(.+)/g,
      /Selector.*is not pure/g,
      /Unknown property:\s*(.+)/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },
  {
    type: 'tailwind',
    framework: 'tailwind',
    patterns: [
      /tailwindcss.*error/gi,
      /The utility class.*does not exist/g,
      /content.*configuration.*is missing/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getTailwindSuggestion(match[0]),
    }),
  },
  {
    type: 'sass',
    patterns: [
      /SassError:\s*(.+)/g,
      /Error:\s*(.+)\s*on line\s*(\d+)/g,
      /Undefined variable/g,
      /Undefined mixin/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      line: match[2] ? parseInt(match[2]) : undefined,
    }),
  },

  // ==================== TESTING ====================
  {
    type: 'jest',
    framework: 'jest',
    patterns: [
      /FAIL\s+([^\s]+)/g,
      /●\s+(.+)/g,
      /expect\(received\)\.(.+)/g,
      /Expected:.*\n.*Received:/g,
      /Cannot find module '([^']+)' from/g,
      /Jest encountered an unexpected token/g,
      /Your test suite must contain at least one test/g,
    ],
    extractor: (match) => ({
      file: match[1]?.endsWith('.test') || match[1]?.endsWith('.spec') ? match[1] : undefined,
      message: match[1] || match[0],
      suggestion: getJestSuggestion(match[0]),
    }),
  },
  {
    type: 'vitest',
    framework: 'vitest',
    patterns: [
      /FAIL\s+([^\s]+)/g,
      /AssertionError:\s*(.+)/g,
    ],
    extractor: (match) => ({
      file: match[1],
      message: match[1] || match[0],
    }),
  },
  {
    type: 'cypress',
    framework: 'cypress',
    patterns: [
      /CypressError:\s*(.+)/g,
      /Timed out retrying/g,
      /cy\.(.+) failed/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },

  // ==================== PACKAGE MANAGERS ====================
  {
    type: 'npm',
    patterns: [
      /npm ERR!\s*(.+)/g,
      /ERESOLVE unable to resolve dependency tree/g,
      /npm WARN deprecated/g,
      /peer dep missing:\s*(.+)/g,
      /Cannot read properties of null/g,
      /ENOENT.*package\.json/g,
      /EACCES.*permission denied/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getNpmSuggestion(match[0]),
    }),
  },
  {
    type: 'yarn',
    patterns: [
      /error\s+(.+)/g,
      /YN0001:\s*(.+)/g,
      /Couldn't find package/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },
  {
    type: 'cocoapods',
    framework: 'ios',
    patterns: [
      /\[!\]\s*(.+)/g,
      /Unable to find a specification for/g,
      /pod install.*failed/gi,
      /CocoaPods could not find compatible versions/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
      suggestion: getCocoaPodsSuggestion(match[0]),
    }),
  },

  // ==================== RUNTIME ERRORS ====================
  {
    type: 'runtime',
    patterns: [
      /TypeError:\s*(.+)/g,
      /ReferenceError:\s*(.+)/g,
      /RangeError:\s*(.+)/g,
      /Error:\s*(.+)/g,
      /Uncaught.*Error:\s*(.+)/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },

  // ==================== MODULE ERRORS ====================
  {
    type: 'module',
    patterns: [
      /Cannot find module ['"]([^'"]+)['"]/g,
      /Module not found:\s*(.+)/g,
      /Could not resolve ['"]([^'"]+)['"]/g,
      /Failed to resolve import "([^"]+)"/g,
      /Unable to resolve module ([^\s]+)/g,
    ],
    extractor: (match) => ({
      message: `Module not found: ${match[1]}`,
      suggestion: `Try running: npm install ${match[1].split('/')[0]}`,
    }),
  },

  // ==================== SYNTAX ERRORS ====================
  {
    type: 'syntax',
    patterns: [
      /SyntaxError:\s*(.+)/g,
      /Unexpected token/g,
      /Unexpected end of/g,
      /Unterminated/g,
      /Invalid or unexpected token/g,
    ],
    extractor: (match) => ({
      message: match[1] || match[0],
    }),
  },
];

// Helper functions for suggestions
function getReactSuggestion(error: string): string | undefined {
  if (error.includes('Invalid hook call')) {
    return 'Hooks can only be called at the top level of a function component. Check for conditional hook calls or ensure you\'re using React 16.8+.';
  }
  if (error.includes('unique "key" prop')) {
    return 'Add a unique key prop to each item in your list. Use the item\'s id or index as the key.';
  }
  if (error.includes('missing dependency')) {
    return 'Add the missing dependency to the useEffect/useCallback dependency array, or wrap the function in useCallback.';
  }
  if (error.includes('Cannot read propert')) {
    return 'Check for null/undefined values. Use optional chaining (?.) or add a null check before accessing properties.';
  }
  return undefined;
}

function getNextJsSuggestion(error: string): string | undefined {
  if (error.includes('use client')) {
    return 'Add "use client" directive at the top of the file when using client-side hooks like useState, useEffect.';
  }
  if (error.includes('Hydration failed')) {
    return 'Ensure server-rendered content matches client content. Avoid using typeof window checks for conditional rendering.';
  }
  if (error.includes('Image with src')) {
    return 'Provide width and height props to next/image, or use fill prop with a positioned parent.';
  }
  return undefined;
}

function getVueSuggestion(error: string): string | undefined {
  if (error.includes('mutating a prop')) {
    return 'Don\'t modify props directly. Emit an event to the parent component or use a local data property.';
  }
  return undefined;
}

function getReactNativeSuggestion(error: string): string | undefined {
  if (error.includes('Unable to resolve module')) {
    return 'Try: 1) Clear Metro cache: npx react-native start --reset-cache, 2) Delete node_modules and reinstall.';
  }
  if (error.includes('Pod install')) {
    return 'Run: cd ios && pod install --repo-update && cd ..';
  }
  if (error.includes('Could not connect to development server')) {
    return 'Ensure Metro bundler is running. Try: npx react-native start --reset-cache';
  }
  if (error.includes('not been registered')) {
    return 'Check that your app name matches in index.js and app.json. Restart the Metro bundler.';
  }
  return undefined;
}

function getExpoSuggestion(error: string): string | undefined {
  if (error.includes('not.*installed')) {
    return 'Run: npx expo install <package-name> to install compatible versions.';
  }
  return undefined;
}

function getFlutterSuggestion(error: string): string | undefined {
  if (error.includes('RenderFlex overflowed')) {
    return 'Wrap the overflowing widget with SingleChildScrollView, Expanded, or Flexible.';
  }
  if (error.includes('Null check operator')) {
    return 'Use null safety: check for null before using ! or use ?. for optional chaining.';
  }
  if (error.includes('pub get failed')) {
    return 'Run: flutter clean && flutter pub get';
  }
  return undefined;
}

function getXcodeSuggestion(error: string): string | undefined {
  if (error.includes('Signing')) {
    return 'Go to Xcode > Signing & Capabilities and configure your team and provisioning profile.';
  }
  return undefined;
}

function getGradleSuggestion(error: string): string | undefined {
  if (error.includes('SDK location not found')) {
    return 'Set ANDROID_HOME environment variable or create local.properties with sdk.dir path.';
  }
  if (error.includes('Manifest merger failed')) {
    return 'Check for conflicting permissions or attributes in AndroidManifest.xml. Use tools:replace to override.';
  }
  return undefined;
}

function getTailwindSuggestion(error: string): string | undefined {
  if (error.includes('content.*configuration')) {
    return 'Add content paths in tailwind.config.js: content: ["./src/**/*.{js,ts,jsx,tsx}"]';
  }
  return undefined;
}

function getJestSuggestion(error: string): string | undefined {
  if (error.includes('unexpected token')) {
    return 'Configure Jest transform for the file type. For TypeScript, add ts-jest or babel-jest.';
  }
  return undefined;
}

function getNpmSuggestion(error: string): string | undefined {
  if (error.includes('ERESOLVE')) {
    return 'Try: npm install --legacy-peer-deps or npm install --force';
  }
  if (error.includes('EACCES')) {
    return 'Fix npm permissions or use a node version manager like nvm.';
  }
  return undefined;
}

function getCocoaPodsSuggestion(error: string): string | undefined {
  if (error.includes('compatible versions')) {
    return 'Try: cd ios && pod install --repo-update && cd ..';
  }
  return undefined;
}

function extractFileFromOutput(output: string): string | undefined {
  const fileMatch = output.match(/(?:at|in|from)\s+([^\s:()]+\.[a-z]+)/i);
  return fileMatch?.[1];
}

export class ErrorDetector {
  private static instance: ErrorDetector;
  private workspaceRoot: string | undefined;
  private errorHistory: ParsedError[] = [];

  private constructor() {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public static getInstance(): ErrorDetector {
    if (!ErrorDetector.instance) {
      ErrorDetector.instance = new ErrorDetector();
    }
    return ErrorDetector.instance;
  }

  /**
   * Check if output contains errors
   */
  public hasErrors(output: string): boolean {
    const errorIndicators = [
      /\berror\b/i,
      /\bfailed\b/i,
      /\bfailure\b/i,
      /ERROR/,
      /FAIL\s/,
      /SyntaxError/,
      /TypeError/,
      /ReferenceError/,
      /Cannot find module/,
      /Module not found/,
      /npm ERR!/,
      /Build Failed/i,
      /ENOENT/,
      /Invariant Violation/,
      /Unhandled.*Error/,
      /\[!\]/,
      /●/,  // Jest failure indicator
    ];

    return errorIndicators.some(pattern => pattern.test(output));
  }

  /**
   * Parse errors from output with smart detection
   */
  public parseErrors(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const seen = new Set<string>();

    for (const errorPattern of ERROR_PATTERNS) {
      for (const pattern of errorPattern.patterns) {
        // Reset regex state
        pattern.lastIndex = 0;
        let match;
        
        while ((match = pattern.exec(output)) !== null) {
          const extracted = errorPattern.extractor(match, output);
          const errorKey = `${extracted.message}-${extracted.file}-${extracted.line}`;
          
          if (seen.has(errorKey)) continue;
          seen.add(errorKey);

          const error: ParsedError = {
            type: errorPattern.type,
            severity: errorPattern.severity || 'error',
            framework: errorPattern.framework,
            fullOutput: output,
            ...extracted,
            message: extracted.message || match[0],
          };

          // Resolve file path
          if (error.file && this.workspaceRoot && !path.isAbsolute(error.file)) {
            const absolutePath = path.join(this.workspaceRoot, error.file);
            if (fs.existsSync(absolutePath)) {
              error.file = absolutePath;
            }
          }

          errors.push(error);
        }
      }
    }

    // Sort by severity and line number
    errors.sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === 'error' ? -1 : 1;
      }
      return (a.line || 0) - (b.line || 0);
    });

    this.errorHistory.push(...errors);
    return errors;
  }

  /**
   * Get rich context for error fixing
   */
  public async getErrorContext(error: ParsedError): Promise<ErrorContext> {
    const context: ErrorContext = {
      previousFixes: this.errorHistory
        .filter(e => e.file === error.file)
        .slice(-5)
        .map(e => e.message),
    };

    if (!error.file || !fs.existsSync(error.file)) {
      return context;
    }

    try {
      const content = fs.readFileSync(error.file, 'utf-8');
      context.fileContent = content;

      const lines = content.split('\n');
      
      // Get surrounding lines (10 before and 5 after)
      if (error.line) {
        const start = Math.max(0, error.line - 11);
        const end = Math.min(lines.length, error.line + 5);
        context.surroundingLines = lines.slice(start, end).map((line, i) => {
          const lineNum = start + i + 1;
          const marker = lineNum === error.line ? ' >>> ' : '     ';
          return `${marker}${lineNum}: ${line}`;
        });
      }

      // Extract imports
      context.imports = lines
        .filter(line => /^import\s/.test(line) || /^const\s.*=\s*require/.test(line))
        .slice(0, 20);

      // Extract exports
      context.exports = lines
        .filter(line => /^export\s/.test(line))
        .slice(0, 10);

      // Get package.json dependencies
      const pkgPath = path.join(this.workspaceRoot || '', 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        context.dependencies = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };
      }
    } catch (e) {
      console.error('[ErrorDetector] Failed to get context:', e);
    }

    return context;
  }

  /**
   * Build an intelligent fix prompt
   */
  public async buildFixPrompt(error: ParsedError): Promise<string> {
    const context = await this.getErrorContext(error);
    
    let prompt = `# Error Fix Request

## Error Details
- **Type:** ${error.type}${error.framework ? ` (${error.framework})` : ''}
- **Severity:** ${error.severity}
- **Message:** ${error.message}
${error.file ? `- **File:** ${error.file}` : ''}
${error.line ? `- **Line:** ${error.line}${error.column ? `:${error.column}` : ''}` : ''}
${error.code ? `- **Code:** ${error.code}` : ''}
${error.rule ? `- **Rule:** ${error.rule}` : ''}

`;

    if (error.suggestion) {
      prompt += `## Suggestion
${error.suggestion}

`;
    }

    if (context.surroundingLines?.length) {
      prompt += `## Code Context
\`\`\`
${context.surroundingLines.join('\n')}
\`\`\`

`;
    }

    if (context.imports?.length) {
      prompt += `## Current Imports
\`\`\`
${context.imports.slice(0, 10).join('\n')}
\`\`\`

`;
    }

    prompt += `## Full Error Output
\`\`\`
${error.fullOutput.slice(0, 2000)}
\`\`\`

## Instructions
1. Analyze the error and identify the root cause
2. Provide the EXACT fix with the correct file path and full corrected code
3. If it's a missing module, suggest the install command
4. Format your response with code blocks indicating the file path:
   \`\`\`typescript:path/to/file.ts
   // corrected code here
   \`\`\`
5. Be concise and fix ONLY the error, don't refactor unrelated code
`;

    return prompt;
  }

  /**
   * Detect project type from workspace
   */
  public detectProjectType(): { framework: string; mobile: boolean; features: string[] } {
    const features: string[] = [];
    let framework = 'unknown';
    let mobile = false;

    if (!this.workspaceRoot) {
      return { framework, mobile, features };
    }

    const pkgPath = path.join(this.workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Detect framework
        if (deps['next']) { framework = 'next'; features.push('ssr'); }
        else if (deps['gatsby']) { framework = 'gatsby'; features.push('ssg'); }
        else if (deps['remix']) { framework = 'remix'; features.push('ssr'); }
        else if (deps['nuxt']) { framework = 'nuxt'; features.push('vue', 'ssr'); }
        else if (deps['vue']) { framework = 'vue'; }
        else if (deps['react-native'] || deps['expo']) { framework = 'react-native'; mobile = true; }
        else if (deps['react']) { framework = 'react'; }
        else if (deps['svelte']) { framework = 'svelte'; }
        else if (deps['angular']) { framework = 'angular'; }

        // Detect features
        if (deps['typescript']) features.push('typescript');
        if (deps['tailwindcss']) features.push('tailwind');
        if (deps['jest'] || deps['vitest']) features.push('testing');
        if (deps['eslint']) features.push('eslint');
        if (deps['prettier']) features.push('prettier');
      } catch (e) {}
    }

    // Check for Flutter
    const pubspecPath = path.join(this.workspaceRoot, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      framework = 'flutter';
      mobile = true;
      features.push('dart');
    }

    // Check for iOS
    const iosPath = path.join(this.workspaceRoot, 'ios');
    if (fs.existsSync(iosPath)) {
      features.push('ios');
      mobile = true;
    }

    // Check for Android
    const androidPath = path.join(this.workspaceRoot, 'android');
    if (fs.existsSync(androidPath)) {
      features.push('android');
      mobile = true;
    }

    return { framework, mobile, features };
  }

  /**
   * Get fix priority based on error type
   */
  public getFixPriority(error: ParsedError): number {
    const priorities: Record<string, number> = {
      'syntax': 1,      // Fix syntax first
      'typescript': 2,  // Then type errors
      'module': 3,      // Then missing modules
      'eslint': 4,      // Then lint errors
      'runtime': 5,     // Then runtime errors
      'build': 6,       // Then build errors
    };
    return priorities[error.type] || 10;
  }

  /**
   * Clear error history
   */
  public clearHistory(): void {
    this.errorHistory = [];
  }
}

export const errorDetector = ErrorDetector.getInstance();
