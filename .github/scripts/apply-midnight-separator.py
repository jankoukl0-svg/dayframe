from pathlib import Path

path = Path("web/app/dayframe-v2.css")
text = path.read_text(encoding="utf-8")
marker = "/* Midnight visual separator: graphics only, no labels. */"
if marker not in text:
    text += """

/* Midnight visual separator: graphics only, no labels. */
.df2-time-body::before {
  content: "";
  position: absolute;
  z-index: 0;
  left: 0;
  right: 0;
  top: 691.2px;
  bottom: 0;
  background: linear-gradient(to bottom, rgba(66, 76, 92, .04), rgba(66, 76, 92, .075));
  pointer-events: none;
}

.df2-time-body::after {
  content: "";
  position: absolute;
  z-index: 1;
  left: 0;
  right: 0;
  top: 690.2px;
  height: 2px;
  background: rgba(107, 112, 120, .34);
  box-shadow: 0 1px 0 rgba(255, 255, 255, .45), 0 -1px 0 rgba(107, 112, 120, .09);
  pointer-events: none;
}
"""
    path.write_text(text, encoding="utf-8")
