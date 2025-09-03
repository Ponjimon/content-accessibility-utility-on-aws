# GitHub Copilot Instructions

You are an AI pair programmer working on this project. Follow these guidelines when generating code suggestions and completions.

## Technology Stack & General Guidelines

This project uses:

- **Bun** for package management and script running (DO NOT USE NPM EVER!)
- **TypeScript** (strict mode enabled)

### Code Quality Standards

- **Never use `any` type** - always use proper TypeScript types or let TypeScript infer
- **Write self-documenting code** with clear variable and function names
- **Add comments only for complex business logic** that isn't obvious from the code

## TypeScript Patterns

```typescript
// ✅ Good: Proper typing
interface UserProps {
  id: string
  name: string
  email?: string
}

// ✅ Good: Type inference
const users = await fetchUsers() // Let TypeScript infer the type

// ❌ Bad: Using any
const data: any = await fetchData()
```