---
title: Hello, world (and some math)
date: 2026-11-10
tags: meta, math
toc: true
---
This is my first post. Markdown works as you would expect: *italics*, **bold**, [links](https://youtu.be/dQw4w9WgXcQ?si=58pFATy9Xr_-VS16), lists, and tables.

## Inline math

Write it as $e^{i\pi} + 1 = 0$ or in the LaTeX style \(\sum_{k=1}^{n} k = \tfrac{n(n+1)}{2}\). Roots work too: $\sqrt{2}$ and \(\sqrt[3]{x+1}\). Money like $5 and $6 stays plain text, and \$x\$ is a literal dollar sign.

## Display math

With double dollars:

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

With LaTeX brackets, across several lines:

\[
\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^s}
        = \prod_{p\ \text{prime}} \frac{1}{1 - p^{-s}}
\]

And with environments:

\begin{align}
(a+b)^2 &= a^2 + 2ab + b^2 \\
        &\ge 4ab
\end{align}

## Everything else

Footnotes work too.[^1]

> Blockquotes look like a 90s guestbook entry.

```js
console.log("code blocks work too, and $dollars$ in code stay untouched");
```

[^1]: Like this one, collected at the bottom of the page.
