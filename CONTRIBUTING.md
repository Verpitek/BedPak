# Contributing to BedPak

Thank you for your interest in contributing to BedPak! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in the [Issues](https://github.com/Verpitek/BedPak/issues) section.
2. If not, create a new issue with a clear title and description.
3. Include steps to reproduce, expected behavior, and actual behavior.
4. Provide relevant logs, screenshots, or error messages.

### Suggesting Features

1. Check if the feature has already been suggested.
2. Create a new issue with the "enhancement" label.
3. Describe the feature, its use case, and potential implementation.

### Submitting Code Changes

1. **Fork the repository** and create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines below.

3. **Write tests** for new functionality and ensure existing tests pass:
   ```bash
   bun test
   ```

4. **Commit your changes** with descriptive commit messages:
   ```bash
   git commit -m "Add feature: brief description"
   ```

5. **Push to your fork** and submit a pull request.

## Development Setup

1. Install [Bun](https://bun.sh) (v1.0.0 or later)
2. Clone your fork:
   ```bash
    git clone https://github.com/Verpitek/BedPak.git
   cd bedpak
   ```
3. Install dependencies:
   ```bash
   bun install
   ```
4. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with test values
   ```
5. Start the development server:
   ```bash
   bun run dev --dev
   ```

## Code Style Guidelines

### TypeScript/JavaScript

- **Imports**: Use ES6 imports. Order: external packages first, then internal modules.
- **Naming**:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and exported constants
  - `UPPER_SNAKE_CASE` for true constants
- **Types**: Use strict TypeScript. Always type function parameters and return values.
- **Formatting**:
  - 2-space indentation
  - Double quotes for strings
  - No semicolons (except in SQL queries)
  - Maximum line length: 100 characters
- **Error Handling**: Wrap database operations in try-catch blocks. Return errors explicitly.

### Database

- Use parameterized queries to prevent SQL injection.
- Use `RETURNING *` to get results after insert/update operations.
- Database columns use `snake_case`.

### File Structure

- Place new API endpoints in `src/index.ts`.
- Database operations go in `src/db_controller.ts`.
- Authentication logic in `src/auth.ts`.
- File storage operations in `src/storage.ts`.

### Testing

- Write tests for new functionality in `src/index.test.ts`.
- Use descriptive test names.
- Test both success and failure cases.
- Mock external dependencies when appropriate.

## Pull Request Process

1. Ensure your code passes all tests.
2. Update documentation if necessary (README, API_GUIDE, DOCUMENTATION).
3. Describe your changes in the pull request description.
4. Link any related issues.
5. Wait for review and address any feedback.

## Release Process

- Version numbers follow [Semantic Versioning](https://semver.org).
- Releases are created by maintainers after merging significant features or bug fixes.

## Questions?

If you have questions, feel free to:
- Open an issue with the "question" label
- Reach out to the maintainers

Thank you for contributing to BedPak!