---
title: Broken front matter
nested:
  key: value
 bad_indent: oops
list: [unclosed
---

# Body after invalid front matter

The block above is not valid YAML: the flow sequence in `list` is never closed, and
`bad_indent` breaks the mapping's indentation.
