# Hostile fixture

Every vector listed in `contracts/security-policy.md` Layer 2, for the sanitiser to
strip. Deliberately holds **no `https:` image**, so the no-network-request assertion
holds with *Load remote images* at its shipped ON.

<script>alert('script')</script>

<img src="x" onerror="alert('onerror')">

<svg onload="alert('onload')"><text>svgtext</text></svg>

<iframe src="https://example.com/"></iframe>

<object data="https://example.com/"></object>

<embed src="https://example.com/">

<form action="https://example.com/submit">
  <input type="text" name="field">
</form>

<link rel="stylesheet" href="https://example.com/style.css">

<style>@import url(https://example.com/style.css);</style>

<meta http-equiv="refresh" content="0;url=https://example.com/">

<base href="https://example.com/">

[javascript link](javascript:alert(1))

[mixed-case javascript link](JaVaScRiPt:alert(1))

[data html link](data:text/html,<script>alert(1)</script>)

<a href="vbscript:msgbox(1)">vbscript link</a>

<video src="https://example.com/video.mp4"></video>

<audio src="https://example.com/audio.mp3"></audio>

![no-https remote image](http://example.com/image.png)

![local file access attempt](file:///C:/Windows/win.ini)

[entity-encoded javascript link](javascript&#58;alert(1))

<div id="throng">DOM-clobbering attempt via a raw id</div>

<form name="throng">DOM-clobbering attempt via a named form</form>

<h2 data-heading-slug="spoof">Spoofed heading slug</h2>

<mark>kept text</mark>

<p aria-hidden="true">aria-hidden paragraph</p>

<span aria-label="relabelled">aria-label span</span>

<input type="image" src="//host/x">

<video><img src="//host/y"></video>
