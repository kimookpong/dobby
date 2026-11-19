import type { ActionName } from "./shared";
export function Avatar({
  action = "neutral",
  level = 0,
}: {
  action?: ActionName;
  level?: number;
}) {
  const happy = action === "happy" || action === "heart";
  return (
    <div className={`avatar avatar-${action}`} aria-label={`Dobby ${action}`}>
      <svg viewBox="0 0 400 470" role="img" aria-label="ตัวละครตัวอย่าง Dobby">
        <defs>
          <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#f0fff9" />
            <stop offset=".55" stopColor="#bcdcd1" />
            <stop offset="1" stopColor="#6e9c91" />
          </linearGradient>
          <linearGradient id="belly" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c8eee1" />
            <stop offset="1" stopColor="#88b5a6" />
          </linearGradient>
          <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#203c37" />
            <stop offset="1" stopColor="#0a1918" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <radialGradient id="orb">
            <stop stopColor="#80ffcf" stopOpacity=".35" />
            <stop offset="1" stopColor="#80ffcf" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="200" cy="433" rx="109" ry="18" fill="#000" opacity=".24" />
        <circle cx="200" cy="255" r="176" fill="url(#orb)" />
        <g className="robot-float">
          <g className="ear-left">
            <path
              d="M104 163 Q42 151 42 83 Q90 67 129 134"
              fill="url(#shell)"
            />
            <path d="M97 140 Q63 124 61 103 Q86 99 110 135" fill="#74bfa5" />
          </g>
          <g className="ear-right">
            <path
              d="M296 163 Q358 151 358 83 Q310 67 271 134"
              fill="url(#shell)"
            />
            <path
              d="M303 140 Q337 124 339 103 Q314 99 290 135"
              fill="#74bfa5"
            />
          </g>
          <path
            d="M138 289 Q126 309 126 366 Q127 405 159 412 L244 412 Q277 405 275 366 Q274 309 261 289"
            fill="url(#belly)"
          />
          <path
            d="M162 400 L154 427 Q178 436 192 424 L190 398"
            fill="url(#shell)"
          />
          <path
            d="M211 398 L210 424 Q227 435 250 427 L239 399"
            fill="url(#shell)"
          />
          <g className="arm-left">
            <path
              d="M143 305 Q113 300 101 327 Q92 352 111 360 Q132 361 145 333"
              fill="url(#shell)"
            />
          </g>
          <g className="arm-right">
            <path
              d="M258 305 Q287 300 300 327 Q309 352 290 360 Q270 361 256 333"
              fill="url(#shell)"
            />
          </g>
          <rect
            x="169"
            y="325"
            width="64"
            height="48"
            rx="17"
            fill="#51786b"
            opacity=".3"
          />
          <path
            d="M185 347 L197 358 L219 335"
            fill="none"
            stroke="#baffd4"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M89 174 Q90 105 158 102 L244 102 Q310 105 312 174 L310 239 Q304 289 255 303 L146 303 Q94 288 90 241Z"
            fill="url(#shell)"
          />
          <rect
            x="106"
            y="153"
            width="189"
            height="113"
            rx="44"
            fill="url(#visor)"
            stroke="#90b8a9"
            strokeWidth="3"
          />
          <path
            d="M128 172 Q200 153 273 172"
            stroke="#c5ffdf"
            strokeOpacity=".12"
            strokeWidth="5"
            fill="none"
          />
          {happy ? (
            <g
              fill="none"
              stroke="#a7ffce"
              strokeWidth="9"
              strokeLinecap="round"
            >
              <path d="M136 209 Q150 190 165 209" />
              <path d="M236 209 Q251 190 265 209" />
            </g>
          ) : (
            <g className="robot-eyes" fill="#aeffd7">
              <rect
                x="139"
                y="190"
                width="21"
                height={action === "surprised" ? 36 : 29}
                rx="10"
              />
              <rect
                x="241"
                y="190"
                width="21"
                height={action === "surprised" ? 36 : 29}
                rx="10"
              />
            </g>
          )}
          <g fill="#87ffc6" opacity=".3" filter="url(#glow)">
            <circle cx="150" cy="204" r="16" />
            <circle cx="251" cy="204" r="16" />
          </g>
          {level > 0.06 || action === "surprised" ? (
            <ellipse
              cx="200"
              cy="238"
              rx={7 + level * 7}
              ry={action === "surprised" ? 10 : 3 + level * 15}
              fill="#9cffce"
            />
          ) : (
            <path
              d="M186 234 Q200 247 214 234"
              stroke="#a7ffce"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />
          )}
          <ellipse
            cx="127"
            cy="232"
            rx="11"
            ry="5"
            fill="#ffaaa8"
            opacity={happy ? ".65" : ".25"}
          />
          <ellipse
            cx="274"
            cy="232"
            rx="11"
            ry="5"
            fill="#ffaaa8"
            opacity={happy ? ".65" : ".25"}
          />
          <path
            d="M180 103 Q180 76 201 72 Q219 73 221 103"
            fill="url(#shell)"
          />
          <rect x="190" y="82" width="21" height="9" rx="4" fill="#8cf9bd" />
        </g>
      </svg>
      {action === "heart" && (
        <>
          <span className="floating-heart h1">♥</span>
          <span className="floating-heart h2">♥</span>
          <span className="floating-heart h3">♥</span>
        </>
      )}
      {action === "surprised" && <span className="surprise-mark">!</span>}
    </div>
  );
}
