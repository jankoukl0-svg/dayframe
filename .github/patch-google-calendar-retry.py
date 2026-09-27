from pathlib import Path

source = Path("web/app/google-calendar-controller.tsx")
text = source.read_text()

old = '  const [error, setError] = useState("");\n  const fetchedRangeRef = useRef("");'
new = '  const [error, setError] = useState("");\n  const [retryNonce, setRetryNonce] = useState(0);\n  const fetchedRangeRef = useRef("");'
if old not in text:
    raise SystemExit("retry state target not found")
text = text.replace(old, new, 1)

old = '  }, [token, range]);'
new = '  }, [token, range, retryNonce]);'
if old not in text:
    raise SystemExit("retry dependency target not found")
text = text.replace(old, new, 1)

marker = '  const disconnect = () => {\n'
insert = '''  const retry = () => {
    fetchedRangeRef.current = "";
    setError("");
    setRetryNonce((value) => value + 1);
  };

'''
if marker not in text:
    raise SystemExit("retry function target not found")
text = text.replace(marker, insert + marker, 1)

old = '      setEvents([]);\n      setError("");\n'
new = '      setEvents([]);\n      setError("");\n      setRetryNonce(0);\n'
if old not in text:
    raise SystemExit("disconnect reset target not found")
text = text.replace(old, new, 1)

old = '      {error && <span className="df2-google-calendar-error" role="status">{error}</span>}\n'
new = '''      {error && <span className="df2-google-calendar-error" role="status">
        {error}
        {token && <button type="button" className="df2-google-calendar-retry" onClick={retry}>Zkusit znovu</button>}
      </span>}
'''
if old not in text:
    raise SystemExit("retry UI target not found")
text = text.replace(old, new, 1)
source.write_text(text)

css = Path("web/app/google-calendar-controller.css")
style = css.read_text()
anchor = '''.df2-google-calendar-month-host {
  display: contents;
}
'''
addition = '''.df2-google-calendar-retry {
  display: block;
  margin-top: 7px;
  padding: 4px 7px;
  border: 1px solid #c59b8c;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: 700 9px/1.2 "Cascadia Mono", monospace;
  cursor: pointer;
}

.df2-google-calendar-retry:hover {
  background: #f5e7e2;
}

'''
if anchor not in style:
    raise SystemExit("retry CSS anchor not found")
style = style.replace(anchor, addition + anchor, 1)
css.write_text(style)
