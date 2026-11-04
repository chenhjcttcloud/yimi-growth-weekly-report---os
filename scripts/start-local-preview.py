#!/usr/bin/env python3
"""Build and start the isolated local preview, retaining previous containers."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
NAME = 'emie-growth-os-app-1'
CONFIG = ROOT / 'outputs/local-preview-runtime.json'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def run(args, capture=False):
    return subprocess.check_output(args, cwd=ROOT, text=True) if capture else subprocess.run(args, cwd=ROOT, check=True)


def inspect(name):
    p = subprocess.run(['docker', 'inspect', name], cwd=ROOT, text=True, capture_output=True)
    return json.loads(p.stdout)[0] if p.returncode == 0 else None


def port_open(port):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def detached(args, log):
    with log.open('ab') as f:
        return subprocess.Popen(args, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=f,
                                stderr=subprocess.STDOUT, start_new_session=True, close_fds=True).pid


def main():
    if not __debug__:
        raise RuntimeError('Run the local preview launcher without Python optimization')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-dir', type=Path, help='Use an already verified local UI build')
    args = parser.parse_args()
    assert run(['docker', 'context', 'show'], True).strip() == 'orbstack', 'Expected local OrbStack context'
    saved = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    profile = os.environ.get('LOCAL_PREVIEW_DIR') or saved.get('profile')
    if not profile:
        choices = sorted((ROOT / 'outputs').glob('production-local-*'), reverse=True)
        profile = next((str(p) for p in choices if (p / 'start-server.mjs').is_file() and (p / 'working/growth.sqlite').is_file()), None)
    assert profile, 'Set LOCAL_PREVIEW_DIR to the previously isolated local data copy'
    profile = Path(profile).resolve()
    assert profile.is_relative_to(ROOT / 'outputs'), 'Preview data must stay in local outputs/'
    launcher = profile / 'start-server.mjs'
    source = launcher.read_text()
    assert 'local_preview_external_requests_disabled' in source and "redirect:'error'" in source, 'Expected isolated launcher'
    db = sqlite3.connect((profile / 'working/growth.sqlite').as_uri() + '?mode=ro', uri=True)
    values = {k: json.loads(v) for k, v in db.execute('SELECT key,value_json FROM app_settings;')}
    db.close()
    for k, fields in {'report_automation_config': ['enabled'], 'month_end_score_reminders': ['enabled'],
                      'operations_config': ['backupEnabled', 'alertsEnabled'], 'scoring360_recurring_config': ['enabled'],
                      'integration_features': ['taskCreateEnabled'], 'feishu_event_security': ['enabled', 'token', 'key'],
                      'ai_runtime': ['encryptedKey'], 'feishu_report': ['appId', 'encryptedSecret']}.items():
        assert k in values and all(not values[k].get(f) for f in fields), 'Local integration is not isolated: ' + k
    # Only this ignored local launcher gains a container-specific static path.
    if 'LOCAL_PREVIEW_STATIC_DIR' not in source:
        old = "STATIC_DIR:working+'/web'"
        assert old in source
        launcher.write_text(source.replace(old, "STATIC_DIR:process.env.LOCAL_PREVIEW_STATIC_DIR||working+'/web'"))
    assert (profile / 'network-isolation.json').is_file()
    stamp = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')
    output = Path(tempfile.mkdtemp(prefix='local-container-' + stamp + '-', dir=ROOT / 'outputs'))
    stamp += '-' + output.name.rsplit('-', 1)[-1]
    node = shutil.which('node')
    web = args.web_dir.resolve() if args.web_dir else output / 'web'
    if not args.web_dir:
        run([node, 'node_modules/typescript/bin/tsc', '-b'])
        run([node, 'node_modules/vite/bin/vite.js', 'build', '--outDir', str(web), '--emptyOutDir', 'false'])
    assert (web / 'index.html').is_file(), 'Missing UI build'
    old_container = inspect(NAME)
    if old_container:
        labels = old_container['Config'].get('Labels') or {}
        managed = labels.get('cn.emie.growth.local-preview') == 'true' and labels.get('cn.emie.growth.project-dir') == str(ROOT)
        recorded = saved.get('container_id') == old_container['Id'] and saved.get('project_dir') == str(ROOT)
        assert managed or recorded or labels.get('com.docker.compose.project.working_dir') == str(ROOT), 'Container is not this local project'
    host_backend = []
    old_ports = {p['HostPort'] for ports in (old_container or {}).get('HostConfig', {}).get('PortBindings', {}).values() for p in (ports or [])}
    if port_open(5174) and '5174' not in old_ports:
        pids = subprocess.run(['lsof', '-tiTCP:5174', '-sTCP:LISTEN'], capture_output=True, text=True, check=True).stdout.split()
        for pid in set(pids):
            cmd = run(['ps', '-p', pid, '-o', 'command='], True)
            assert str(launcher) in cmd and 'node' in cmd, 'Port 5174 belongs to another local service'
            host_backend.append(int(pid))
    if port_open(5180):
        assert '5180' in old_ports, 'Port 5180 belongs to another service'
    stage = output / 'stage'
    stage.mkdir()
    ignored = shutil.ignore_patterns('.env*', '*.sqlite*', '*.db', '*.pem', '*.key', 'private', '__pycache__', '.DS_Store')
    for relative in ['server', 'scripts', 'db', 'src/data']:
        shutil.copytree(ROOT / relative, stage / relative, ignore=ignored)
    shutil.copy2(ROOT / 'package.json', stage / 'package.json')
    shutil.copytree(web, stage / 'web')
    image = 'emie-growth-os:local-preview-' + stamp
    run(['docker', 'image', 'inspect', 'emie-growth-os:local'], capture=True)
    run(['docker', 'build', '--build-arg', 'BASE_IMAGE=emie-growth-os:local',
         '--build-arg', 'RELEASE_ID=local-' + stamp, '--build-arg', 'SOURCE_REVISION=local-worktree',
         '-f', str(ROOT / 'deploy/Dockerfile.release'), '-t', image, str(stage)])
    user = str(os.getuid()) + ':' + str(os.getgid())
    mounts = ['--mount', 'type=bind,src=' + str(profile) + ',dst=/app/local-preview,readonly',
              '--mount', 'type=bind,src=' + str(profile / 'working') + ',dst=/app/local-preview/working',
              '--mount', 'type=bind,src=' + str(profile / 'network-isolation.json') + ',dst=/app/local-preview/network-isolation.json']
    # No --rm: even this short permission check is retained for inspection.
    check = "const f=require('fs');f.accessSync('/app/local-preview/local-session-secret.txt',f.constants.R_OK);f.accessSync('/app/local-preview/working/growth.sqlite',f.constants.R_OK|f.constants.W_OK);f.accessSync('/app/server/index.mjs',f.constants.R_OK);f.accessSync('/app/dist/index.html',f.constants.R_OK);require('child_process').execFileSync('sqlite3',['--version']);console.log('Local preview permissions verified')"
    run(['docker', 'run', '--name', 'emie-growth-os-permission-check-' + stamp, '--user', user,
         '--workdir', '/app'] + mounts + [image, 'node', '-e', check])
    retained = NAME + '-retained-local-' + stamp
    old_running = old_container and old_container['State']['Running']
    renamed = False
    try:
        if old_container:
            current = inspect(NAME)
            assert current and current['Id'] == old_container['Id'] and current['State']['Running'] == old_running, 'Local container changed during build'
            if old_running:
                run(['docker', 'stop', '--time', '30', old_container['Id']])
            run(['docker', 'rename', old_container['Id'], retained])
            renamed = True
        for pid in host_backend:
            cmd = run(['ps', '-p', str(pid), '-o', 'command='], True)
            assert str(launcher) in cmd and 'node' in cmd, 'Backend PID changed during build'
            os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 10
        while port_open(5174) and time.monotonic() < deadline:
            time.sleep(.25)
        assert not port_open(5174), 'Port 5174 did not become available'
        run(['docker', 'run', '-d', '--name', NAME, '--restart', 'unless-stopped', '--init', '--user', user,
             '--workdir', '/app', '--label', 'cn.emie.growth.local-preview=true',
             '--label', 'cn.emie.growth.project-dir=' + str(ROOT),
             '--label', 'cn.emie.growth.local-preview.run=' + stamp,
             '--health-interval=5s', '--health-start-period=5s', '--health-timeout=5s',
             '-p', '0.0.0.0:5180:5174', '-p', '0.0.0.0:5174:5174',
             '-e', 'TZ=Asia/Shanghai', '-e', 'LOCAL_PREVIEW_STATIC_DIR=/app/dist'] + mounts +
            [image, 'node', '/app/local-preview/start-server.mjs'])
        deadline = time.monotonic() + 60
        while True:
            try:
                with OPENER.open('http://127.0.0.1:5180/health', timeout=3) as r:
                    health = json.load(r)
                assert health.get('ok') and health.get('storageReady') and health.get('authMode') == 'mock'
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.5)
        with OPENER.open('http://127.0.0.1:5180/', timeout=10) as r:
            assert hashlib.sha256(r.read()).digest() == hashlib.sha256((web / 'index.html').read_bytes()).digest(), 'Container UI differs from latest build'
        if not port_open(5173):
            detached([node, 'node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], output / 'frontend.log')
        for port in [5173, 5174, 5180]:
            deadline = time.monotonic() + 15
            while True:
                try:
                    with OPENER.open('http://127.0.0.1:%d/api/me' % port, timeout=3) as r:
                        assert json.load(r).get('user')
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.5)
    except BaseException:
        recovery_errors = []
        failed = inspect(NAME)
        if failed and failed['Config']['Image'] == image and (failed['Config'].get('Labels') or {}).get('cn.emie.growth.local-preview.run') == stamp:
            try:
                run(['docker', 'stop', '--time', '15', failed['Id']])
                run(['docker', 'rename', failed['Id'], NAME + '-failed-local-' + stamp])
            except Exception as e:
                recovery_errors.append(str(e))
        if renamed:
            try:
                run(['docker', 'rename', old_container['Id'], NAME])
            except Exception as e:
                recovery_errors.append(str(e))
        if old_container and old_running:
            try:
                run(['docker', 'start', old_container['Id']])
            except Exception as e:
                recovery_errors.append(str(e))
        if host_backend and not port_open(5174):
            detached([node, str(launcher)], output / 'backend-rollback.log')
        if recovery_errors:
            (output / 'recovery-errors.json').write_text(json.dumps(recovery_errors, indent=2) + '\n')
            print('Local recovery needs attention; details: ' + str(output / 'recovery-errors.json'))
        raise
    result = {'profile': str(profile), 'project_dir': str(ROOT), 'container': NAME,
              'container_id': inspect(NAME)['Id'], 'image': image,
              'retained_container': retained if renamed else None, 'health': health,
              'frontend': 'http://localhost:5173', 'container_preview': 'http://localhost:5180',
              'evidence': str(output), 'production_modified': False}
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    CONFIG.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
