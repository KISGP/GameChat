import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // JSDoc 与命名纪律由 review 承担；此处只拦可机械判定的错误模式。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)
