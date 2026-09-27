// Kelingking: the entry point. The landing page (the scroll descent, src/scroll/) unless the URL
// asks for a shot, in which case the tools that match the scene to reference photos
// (src/debug.js). The scene itself is src/app.js. index.html sets the class on <html> before
// anything draws, from the same test.
//
//   /                      the landing page (?debug adds the settings panel, keys and a readout)
//   /?shot=viewpoint       the tools, on a shot (?capture, ?cam= too); URL switches in debug.js
//                          and app.js

import { createApp } from './app.js';
import { startTools } from './debug.js';
import { startScroll } from './scroll/scroll.js';

const params = new URLSearchParams(location.search);
if (document.documentElement.classList.contains('tool')) {
  const capture = params.has('capture');
  if (capture) document.body.classList.add('capture');
  startTools(createApp({ params, capture }), { params, capture });
} else {
  startScroll({ params });
}
