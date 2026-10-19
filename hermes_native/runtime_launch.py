"""Activate the official image dependencies, then load the accepted application overlay.

The immutable Hermes bootstrap, CLI and Docker launcher remain in the image. This
entry point changes only Python application import precedence, never root execution.
"""
import os
import sys
from pathlib import Path

BASE = Path('/opt/hermes')


def activate(tree):
    sys.path.insert(0, str(BASE))
    import site
    site.addsitedir('/opt/ziwei-extras')
    import hermes_bootstrap  # Official dependency activation, before application imports.
    from hermes_cli.main import main
    prefixes = ('agent', 'tools', 'gateway', 'cron', 'plugins')
    top = {'run_agent', 'model_tools', 'toolsets', 'hermes_state', 'hermes_state_messages'}
    for name in list(sys.modules):
        if name in top or any(name == p or name.startswith(p + '.') for p in prefixes):
            del sys.modules[name]
    sys.path.insert(0, str(tree))
    os.environ['HERMES_PYTHON_SRC_ROOT'] = str(tree)
    # Immutable adapter binds native browser calls to the owning profile. It is
    # also checked by candidate preflight, after imports switch to that tree.
    from browser_persistence import install
    install()
    from web_bridge import install as install_web_bridge
    install_web_bridge()
    return main


if __name__ == '__main__':
    if sys.argv[1:2] == ['--preflight']:
        tree = Path(sys.argv[2]); activate(tree)
        import run_agent, model_tools, toolsets
        from hermes_cli.config import load_config
        from hermes_cli.tools_config import _get_platform_tools
        config = load_config()
        assert config['platforms']['api_server']['enabled']
        enabled = sorted(_get_platform_tools(config, 'api_server'))
        definitions = model_tools.get_tool_definitions(enabled_toolsets=enabled, quiet_mode=True)
        assert len(definitions) > 20
        # Progressive disclosure can defer plugin tools behind the tool-search bridge.
        catalog = model_tools.get_tool_definitions(enabled_toolsets=enabled, quiet_mode=True,
                                                   skip_tool_search_assembly=True)
        catalog_names = {t.get('function', {}).get('name') for t in catalog}
        assert 'ziwei_status' in catalog_names, 'ziwei_status missing from resolved api_server tools'
        visible_names = {t.get('function', {}).get('name') for t in definitions}
        if 'ziwei_status' not in visible_names:
            assert {'tool_search', 'tool_describe', 'tool_call'} <= visible_names, \
                'ziwei_status deferred without a working tool_search bridge'
            print('[ziwei] ziwei_status resolvable through the tool_search bridge.')
        else:
            print('[ziwei] ziwei_status visible in resolved api_server tool definitions.')
    else:
        tree = Path(os.environ.get('ZIWEI_TEST_TREE', '/opt/ziwei-runtime/current'))
        main = activate(tree)
        sys.argv = ['hermes', *sys.argv[1:]]
        sys.exit(main())
