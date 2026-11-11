---
title: Hello, world (and some math)
date: 2026-11-10
tags: meta, math
toc: true
---
This is my first post. Markdown works as you'd expect: *italics*, **bold**, [links](https://example.com), lists, and tables.

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

\[
\begin{aligned}
I &=\int_0^{\pi/4}
\frac{\cos x}{3+4\sin x\cos x+4\sin^2x\cos^2x}
\,\mathrm{d}x\\
&=\int_0^{\pi/4}
\frac{\cos x}{2+(\sin x+\cos x)^4}\,\mathrm{d}x\\
v &=\sin x+\cos x,\qquad
\frac{\mathrm{d}v}{\mathrm{d}x}
=\cos x-\sin x=\sqrt{2-v^2}\\
\cos x\,\mathrm{d}x
&=\frac12\left(1+\frac{v}{\sqrt{2-v^2}}\right)\mathrm{d}v\\
I &=\frac12\int_1^{\sqrt2}
\frac{1+\dfrac{v}{\sqrt{2-v^2}}}{v^4+2}\,\mathrm{d}v\\
w &=\sqrt{2-v^2}\\
I &=\frac12\left[
\int_1^{\sqrt2}\frac{\mathrm{d}v}{v^4+2}
+\int_0^1\frac{\mathrm{d}w}{w^4-4w^2+6}
\right]\\[5pt]
\alpha &=\sqrt{2\sqrt b-a},\qquad
\beta=\sqrt b,\qquad
\delta=\frac{2\beta+a}{4}\\
P_{a,b}(t)
&:=\frac{1}{4\alpha\beta}
\ln\frac{t^2+\alpha t+\beta}{t^2-\alpha t+\beta}\\
&\quad+\frac{1}{4\beta\sqrt\delta}
\left[
\arctan\frac{t+\alpha/2}{\sqrt\delta}
+\arctan\frac{t-\alpha/2}{\sqrt\delta}
\right]\\
P_{a,b}'(t) &=\frac{1}{t^4+ a t^2+b},
\qquad P_{a,b}(0)=0\\[5pt]
I &=\frac12\left[
P_{0,2}(\sqrt2)-P_{0,2}(1)+P_{-4,6}(1)
\right]
\end{aligned}
\]

And with environments:

\begin{align}
(a+b)^2 &= a^2 + 2ab + b^2 \\
        &\ge 4ab
\end{align}

## Everything else

Footnotes work too.[^1]

> Blockquotes look like a proper 90s guestbook entry.

```js
console.log("code blocks work too, and $dollars$ in code stay untouched");
```

[^1]: Like this one, collected at the bottom of the page.
