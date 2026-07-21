import importlib.util, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("session", os.path.join(ROOT, "api", "auth", "session.py"))
session = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(session)

def _set(mode, ks):
    if mode is None: os.environ.pop("ADVICE_MODE", None)
    else: os.environ["ADVICE_MODE"] = mode
    if ks is None: os.environ.pop("NISA_ADVICE_ENABLED", None)
    else: os.environ["NISA_ADVICE_ENABLED"] = ks

def test_nisa_advice_enabled_logic():
    _set("personal", "1");   assert session.nisa_advice_enabled() is True
    _set("personal", "true"); assert session.nisa_advice_enabled() is True
    _set("personal", "on");  assert session.nisa_advice_enabled() is True
    _set("personal", "0");   assert session.nisa_advice_enabled() is False   # killswitch off
    _set("personal", None);  assert session.nisa_advice_enabled() is False   # 未設定=off
    _set("production", "1"); assert session.nisa_advice_enabled() is False   # production 遮断
    _set(None, "1");         assert session.nisa_advice_enabled() is False

def test_insight_enabled_unchanged():
    _set("personal", "0"); assert session.insight_enabled() is True          # 既存挙動不変
