// Prints the bomb-out page's best-lift block, ready, as the server renders it (for best-lift-buttons.spec.ts:
// Playwright's own loader can't import the icon package, so the spec runs this with tsx). The site's tsconfig keeps
// JSX for Next to compile, so tsx compiles it to React.createElement, which needs React in scope.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;
const { BestLiftClip } = await import('../../web/components/best-lift-clip');
process.stdout.write(renderToStaticMarkup(React.createElement(BestLiftClip, { ready: true, failed: null, length: '0:14', label: 'x' })));
