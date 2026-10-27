// Linter: hanya aturan yang menangkap cacat nyata (janji tak ditangani, penanganan async yang salah), bukan gaya penulisan.
// Contoh cacat yang akan tertangkap: `void svc.job().finally(...)` tanpa `.catch` yang mematikan proses saat gagal.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const promiseRules = {
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, arguments: false, properties: false } }],
  '@typescript-eslint/await-thenable': 'error',
};

// `void p.finally(...)` / `void p.then(f)` lolos dari no-floating-promises (void dianggap disengaja) padahal tetap menolak tanpa penangan.
// Inilah bentuk cacat penjadwal marketplace yang bisa mematikan proses Node saat galat.
const voidChainRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "UnaryExpression[operator='void'] > CallExpression[callee.property.name='finally']:not([callee.object.callee.property.name='catch'])",
      message: 'void promise.finally(...) tanpa .catch(...) membuat penolakan tak tertangani. Tambahkan .catch(logger) sebelum .finally.',
    },
    {
      selector: "UnaryExpression[operator='void'] > CallExpression[callee.property.name='then'][arguments.length=1]",
      message: 'void promise.then(f) tanpa penangan galat membuat penolakan tak tertangani. Tambahkan .catch(...) atau argumen kedua.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'backend/drizzle/**', 'backend/scripts/**', 'frontend/public/**'] },
  {
    files: ['backend/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...promiseRules, ...voidChainRules },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: { ...promiseRules, 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { files: ['**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx', 'backend/test/**'], rules: { '@typescript-eslint/no-floating-promises': 'off', '@typescript-eslint/no-misused-promises': 'off' } },
);
