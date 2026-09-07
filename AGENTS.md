# Project conventions

- Keep code readable: clear names, small focused functions, and explicit types at boundaries.
- Leave a blank line between function declarations, callback registrations, and separate logical steps. Group closely related statements together; do not compress the code into a wall of statements.
- Separate imports from external packages, local modules, and styles with blank lines. Leave blank lines between CSS rules.
- Use braces for conditionals, including one-line guards. Prettier preserves intentional spacing but does not add all of these readability breaks; review them manually.
- Add comments for non-obvious behavior and tradeoffs; do not narrate obvious code.
- Separate HTTP transport, task operations, Google API access, and authentication as they are introduced. Avoid speculative abstraction layers.
- Keep the UI focused on task cards shown in response to conversation. Do not add a full task dashboard or shared-team features.
- Use the local shadcn/ui components in `apps/ui/src/components/ui` for supported controls, including the composed calendar/popover date picker.
- Use Tailwind utility classes for component layout and styling. Keep CSS files limited to imports, shared theme tokens, and base styles; do not add custom component selectors.
- Resolve Google credentials from authenticated server-side identity, never from user IDs supplied by the model or browser.
- Never expose credentials in tool results, browser bundles, logs, or committed files.
- Use strict TypeScript. Document any narrowly scoped compiler exceptions.
- Run typechecking, formatting checks, and builds for code changes. Run the MCP smoke check after backend changes.
- Keep this project incremental: implement the current agreed step before adding future features.
