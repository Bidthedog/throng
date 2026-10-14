# Hostile diagrams

Every block below tries something a diagram must never do (054 FR-045). Rendered, none of it may run,
navigate or fetch.

```mermaid
%%{init: {"securityLevel": "loose", "startOnLoad": true}}%%
graph TD
  A["<script>window.__pwned = 1</script>"] --> B["<img src='https://evil.example/pixel.png' onerror='window.__pwned = 2'>"]
  click A callback "window.__pwned = 3"
  click B href "javascript:window.__pwned = 4"
  classDef bad fill:url(https://evil.example/fill.png)
  class A bad
```

```mermaid
sequenceDiagram
  Alice->>Bob: <a href="javascript:alert(1)">follow me</a>
  Note right of Bob: <foreignObject><iframe src="https://evil.example/"></iframe></foreignObject>
```

Plain text after the diagrams.
