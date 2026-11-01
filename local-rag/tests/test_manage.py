import importlib.util, unittest, tempfile, pathlib, socket, sys
spec = importlib.util.spec_from_file_location('manage', pathlib.Path(__file__).parents[1] / 'scripts/manage.py')
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
    def test_foreign_port_is_rejected(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); s.listen()
            with self.assertRaises(RuntimeError): self.m.require_free(s.getsockname()[1])
    def test_reused_pid_is_not_stopped(self):
        self.assertFalse(self.m.owns_process({'pid': 1, 'marker': '/nonexistent-rag-marker', 'start': 'invalid'}))
    def test_uninstall_plan_is_read_only(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'keep'; p.write_text('keep')
            plan=self.m.uninstall_plan(pathlib.Path(d), {'consumers': ['shiping','other']})
            self.assertTrue(p.exists()); self.assertFalse(plan['can_remove_shared'])
    def test_shared_consumer_blocks_whole_removal(self):
        self.assertFalse(self.m.uninstall_plan(pathlib.Path('/tmp/test'), {'consumers':['shiping','other']})['can_remove_shared'])
    def test_web_projects_are_discovered_before_shared_removal(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d); p=root/'data/admin/projects/owned-project'; p.mkdir(parents=True); (p/'project.json').write_text('{}')
            plan=self.m.uninstall_plan(root,{'consumers':['shiping']})
            self.assertFalse(plan['can_remove_shared'])
            self.assertIn('web-project:owned-project',plan['other_consumers'])
    def test_start_provisions_directories_and_tracks_owned_http_service(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            with socket.socket() as s: s.bind(('127.0.0.1',0));port=s.getsockname()[1]
            script=root/'fixture_admin.py';script.write_text('from http.server import HTTPServer,BaseHTTPRequestHandler\nclass H(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200);self.end_headers()\nHTTPServer(("127.0.0.1",'+str(port)+'),H).serve_forever()\n')
            self.m.ROOT=root
            self.m.services=lambda:{'admin':([sys.executable,str(script)],port,str(script))}
            self.m.URLS={'admin':f'http://127.0.0.1:{port}/'}
            try:
                self.m.start()
                self.assertTrue(self.m.status()['admin']['owned'])
                self.assertTrue(self.m.status()['admin']['ready'])
            finally:self.m.stop()
            self.assertFalse((root/'run/admin.json').exists())
if __name__ == '__main__': unittest.main()
