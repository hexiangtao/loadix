# Markdown Rendering Demo

Supports **GFM** (tables, task lists, strikethrough), syntax highlighting, math formulas, and **Mermaid diagrams**.

## Mermaid Diagrams

> Hover any diagram and click the button in its top-right corner to export it as a PNG image.

### Flowchart

```mermaid
flowchart LR
  A[Start] --> B{Testing?}
  B -- Yes --> C[Run load test]
  B -- No --> D[Share screenshot]
  C --> E[(Report)]
  D --> E
```

### Sequence diagram

```mermaid
sequenceDiagram
  participant U as User
  participant E as Engine
  participant S as Server
  U->>E: Start load test
  E->>S: HTTP request x N
  S-->>E: 200 OK
  E->>U: Live metrics
```

### Pie chart

```mermaid
pie title Response status distribution
  "2xx" : 92
  "4xx" : 6
  "5xx" : 2
```

## Table

| Method | Route | P95 latency |
| --- | --- | --- |
| GET | /api/users | 84 ms |
| POST | /api/orders | 132 ms |

- [x] Build the load test engine
- [x] Ship 18 built-in developer tools
- [ ] Go global

## Code highlighting

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## Math

Inline math $E = mc^2$, and a display equation:

$$
P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}
$$

> Tip: write `mermaid` as the language of a code block to draw any diagram.