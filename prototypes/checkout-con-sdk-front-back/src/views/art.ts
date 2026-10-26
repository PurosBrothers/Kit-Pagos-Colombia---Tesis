/**
 * Las botellas de la vitrina, dibujadas aquí para no depender de imágenes con derechos ni de los
 * logos de las bodegas: una bodega en penumbra, la cordillera y el valle de Sugamuxi al sol. Cada
 * `<symbol>` se usa con `<use href="#art-…">` desde la tarjeta del producto.
 */
const BOTTLE = "M90 16 H110 V62 Q110 74 122 84 Q132 93 132 110 V198 Q132 206 124 206 H76 Q68 206 68 198 V110 Q68 93 78 84 Q90 74 90 62 Z";

export const BOTTLE_SPRITE = `<svg class="sprite" aria-hidden="true">
  <symbol id="art-casillero" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#2a0f16" />
    <path d="M28 220 V96 Q28 40 100 40 Q172 40 172 96 V220 Z" fill="#3d1520" />
    <path d="M44 220 V102 Q44 58 100 58 Q156 58 156 102 V220" fill="none" stroke="#5c2431" stroke-width="3" />
    <ellipse cx="100" cy="212" rx="46" ry="5" fill="#140609" />
    <path d="${BOTTLE}" fill="#141a14" />
    <rect x="89" y="14" width="22" height="30" rx="2" fill="#8c1c2c" />
    <rect x="76" y="124" width="48" height="56" rx="3" fill="#0d0d0d" stroke="#c9a24a" stroke-width="2" />
    <path d="M88 160 V146 Q88 136 100 136 Q112 136 112 146 V160" fill="none" stroke="#c9a24a" stroke-width="2" />
    <rect x="84" y="166" width="32" height="3" rx="1.5" fill="#c9a24a" />
    <rect x="90" y="172" width="20" height="2" rx="1" fill="#8c1c2c" />
    <rect x="73" y="112" width="4" height="70" rx="2" fill="#ffffff" opacity="0.12" />
  </symbol>
  <symbol id="art-malbec" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#3b1a46" />
    <path d="M0 150 L36 96 L58 122 L92 70 L120 110 L146 84 L200 148 V220 H0 Z" fill="#5a2c68" />
    <path d="M80 86 L92 70 L104 87 L97 84 L92 90 L86 84 Z M136 96 L146 84 L157 97 L150 95 L146 99 Z" fill="#f2ecf3" />
    <rect y="176" width="200" height="44" fill="#2a1232" />
    <path d="${BOTTLE}" fill="#16101a" />
    <rect x="89" y="14" width="22" height="30" rx="2" fill="#5b2a6e" />
    <rect x="76" y="124" width="48" height="56" rx="3" fill="#f3ede4" />
    <path d="M82 158 L92 146 L100 154 L108 142 L118 158 Z" fill="#5b2a6e" />
    <rect x="84" y="164" width="32" height="3" rx="1.5" fill="#3b1a46" />
    <rect x="90" y="170" width="20" height="2" rx="1" fill="#9a7bb0" />
    <rect x="73" y="112" width="4" height="70" rx="2" fill="#ffffff" opacity="0.12" />
  </symbol>
  <symbol id="art-puntalarga" viewBox="0 0 200 220">
    <rect width="200" height="220" fill="#cfe3c4" />
    <circle cx="152" cy="52" r="22" fill="#f4c542" />
    <path d="M0 132 Q48 98 96 124 Q150 92 200 118 V220 H0 Z" fill="#6f9a5a" />
    <path d="M0 162 Q60 132 118 156 Q164 140 200 152 V220 H0 Z" fill="#456f3c" />
    <path d="M14 182 H186 M22 194 H178 M32 206 H168" stroke="#2f5129" stroke-width="2" stroke-dasharray="4 5" />
    <path d="${BOTTLE}" fill="#1f2b1a" />
    <rect x="89" y="14" width="22" height="30" rx="2" fill="#b3312c" />
    <rect x="76" y="124" width="48" height="56" rx="3" fill="#fbf8ef" stroke="#456f3c" stroke-width="2" />
    <circle cx="100" cy="146" r="8" fill="#f4c542" />
    <path d="M82 162 Q92 154 100 160 Q110 152 118 160" fill="none" stroke="#456f3c" stroke-width="2.5" />
    <rect x="86" y="168" width="28" height="3" rx="1.5" fill="#b3312c" />
    <rect x="73" y="112" width="4" height="70" rx="2" fill="#ffffff" opacity="0.14" />
  </symbol>
</svg>`;
