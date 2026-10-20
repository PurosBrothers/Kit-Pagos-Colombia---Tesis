/**
 * Las portadas de la vitrina, dibujadas aquí para no depender de imágenes con derechos: una
 * luna con un murciélago, una estrella roja y una telaraña. Cada `<symbol>` se usa con
 * `<use href="#art-…">` desde la tarjeta del producto.
 */
export const COVER_SPRITE = `<svg class="sprite" aria-hidden="true">
  <defs>
    <pattern id="halftone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1.3" fill="#ffffff" opacity="0.14" />
    </pattern>
  </defs>
  <symbol id="art-batman" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#14213d" />
    <rect width="200" height="220" fill="url(#halftone)" />
    <circle cx="100" cy="92" r="56" fill="#f4c20d" />
    <path d="M52 102 Q62 82 76 88 Q80 74 90 79 L95 68 L100 76 L105 68 L110 79 Q120 74 124 88 Q138 82 148 102 Q132 95 123 104 Q113 95 100 113 Q87 95 77 104 Q68 95 52 102 Z" fill="#0b0b0b" />
    <path d="M0 220 L0 178 L18 178 L18 160 L34 160 L34 184 L48 184 L48 150 L66 150 L66 176 L80 176 L80 166 L96 166 L96 188 L112 188 L112 156 L130 156 L130 180 L146 180 L146 168 L162 168 L162 186 L178 186 L178 158 L200 158 L200 220 Z" fill="#0a1124" />
    <rect x="52" y="160" width="4" height="5" fill="#f4c20d" opacity="0.8" />
    <rect x="118" y="164" width="4" height="5" fill="#f4c20d" opacity="0.8" />
    <rect x="184" y="166" width="4" height="5" fill="#f4c20d" opacity="0.8" />
  </symbol>
  <symbol id="art-superman" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#c8102e" />
    <rect width="200" height="220" fill="url(#halftone)" />
    <circle cx="100" cy="104" r="70" fill="#9c0c24" />
    <polygon points="100,46 113,86 155,86 121,111 134,151 100,126 66,151 79,111 45,86 87,86" fill="#f4c20d" stroke="#16130f" stroke-width="4" stroke-linejoin="round" />
    <path d="M24 196 L176 196 M40 206 L160 206 M58 186 L142 186" stroke="#f7f3ea" stroke-width="3" stroke-linecap="round" opacity="0.55" />
  </symbol>
  <symbol id="art-spiderman" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#1d4e9e" />
    <path d="M0 0 L200 0 L200 220 Z" fill="#c8102e" />
    <rect width="200" height="220" fill="url(#halftone)" />
    <g stroke="#0b0b0b" stroke-width="2.4" fill="none">
      <path d="M100 110 L210 110 M100 110 L178 188 M100 110 L100 220 M100 110 L22 188 M100 110 L-10 110 M100 110 L22 32 M100 110 L100 0 M100 110 L178 32" />
      <polygon points="125,110 118,128 100,135 82,128 75,110 82,92 100,85 118,92" />
      <polygon points="150,110 135,145 100,160 65,145 50,110 65,75 100,60 135,75" />
      <polygon points="175,110 153,163 100,185 47,163 25,110 47,57 100,35 153,57" />
    </g>
    <g stroke="#f7f3ea" stroke-width="2.4" stroke-linecap="round">
      <path d="M100 104 L84 90 M100 104 L116 90 M100 108 L80 104 M100 108 L120 104 M100 114 L82 124 M100 114 L118 124 M100 118 L88 134 M100 118 L112 134" />
    </g>
    <ellipse cx="100" cy="104" rx="6" ry="5" fill="#f7f3ea" />
    <ellipse cx="100" cy="116" rx="8" ry="9" fill="#f7f3ea" />
  </symbol>
</svg>`;
