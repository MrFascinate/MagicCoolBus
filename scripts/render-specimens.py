"""
Simulated scanning electron microscope (SEM) images for Microscopic Madness.

Run headless with the pip `bpy` module (Blender 5.1):
    python3 scripts/render-specimens.py                    # all 9 specimens, 4 zoom steps, 1024 px
    python3 scripts/render-specimens.py --only salt,hair --steps 0,3 --res 384 --samples 8 --out /tmp/semprev

Units: 1 Blender unit = 1 micrometre. Every view uses an orthographic camera,
so the image width in micrometres is exactly the camera's ortho scale.
These are SIMULATIONS. The game labels them "Simulated image", and
manifest.json marks every file simulated: true so real micrographs can
replace them later without code changes.

Look of an SEM secondary-electron image, imitated here:
  * grayscale, no colour
  * edges and tilted faces glow brighter than faces that point at the viewer
  * crevices are dark (fewer electrons escape)
  * deep focus (no depth of field) and a soft side shadow from the detector
"""
import sys, os, math, json, time, argparse
import numpy as np
import bpy
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--steps', default='0,1,2,3')
ap.add_argument('--res', type=int, default=1024)
ap.add_argument('--samples', type=int, default=20)
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'microscope'))
ap.add_argument('--maxkb', type=float, default=40.0)
ap.add_argument('--png', action='store_true', help='also keep the raw PNG')
ap.add_argument('--manifest-only', action='store_true', help='write manifest.json from the WebP files already in --out')
ap.add_argument('--encode-only', action='store_true', help='re-encode WebP files from raw PNGs kept with --png (resized to --res)')
args = ap.parse_args([a for a in sys.argv[1:]])
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
STEPS = [int(s) for s in args.steps.split(',')]

rng = np.random.default_rng(7)


# ---------------------------------------------------------------- scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = args.samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 2
    sc.cycles.diffuse_bounces = 1
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 0
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 2
    sc.render.resolution_x = sc.render.resolution_y = args.res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.06
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_np(name, V, F, smooth=True, mat=None):
    """Mesh from numpy arrays: V (n,3) floats, F (m,k) ints with one face size."""
    V = np.asarray(V, dtype=np.float32)
    F = np.asarray(F, dtype=np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set('co', V.ravel())
    k = F.shape[1]
    me.loops.add(F.size)
    me.loops.foreach_set('vertex_index', F.ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set('loop_start', np.arange(0, F.size, k, dtype=np.int32))
    me.update(calc_edges=True)
    if smooth:
        me.shade_smooth()
    if mat:
        me.materials.append(mat)
    return me


class Acc:
    """Accumulates swept parts into one mesh: quads, caps (n-gons) and per-vertex UVs."""
    def __init__(self):
        self.V, self.Q, self.P, self.UV, self.n = [], [], [], [], 0

    def add(self, V, Q, polys=(), uv=None):
        self.V.append(np.asarray(V, np.float32)); self.Q.append(np.asarray(Q, np.int64) + self.n)
        self.P.extend([[i + self.n for i in f] for f in polys])
        self.UV.append(np.zeros((len(V), 2), np.float32) if uv is None else np.asarray(uv, np.float32))
        self.n += len(V)

    def build(self, name, mat=None, smooth=True):
        V = np.concatenate(self.V); Q = np.concatenate(self.Q).astype(np.int32)
        sizes = np.concatenate([np.full(len(Q), 4), np.array([len(f) for f in self.P], dtype=np.int64)]).astype(np.int32)
        loops = np.concatenate([Q.ravel(), np.array([i for f in self.P for i in f], dtype=np.int32)]).astype(np.int32)
        me = bpy.data.meshes.new(name)
        me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
        me.loops.add(len(loops)); me.loops.foreach_set('vertex_index', loops)
        me.polygons.add(len(sizes))
        me.polygons.foreach_set('loop_start', (np.cumsum(sizes) - sizes).astype(np.int32))
        me.update(calc_edges=True)
        uv = np.concatenate(self.UV)
        lay = me.uv_layers.new(name='UVMap')
        lay.data.foreach_set('uv', uv[loops].ravel())
        if smooth:
            me.shade_smooth()
        if mat:
            me.materials.append(mat)
        return me


def mesh_py(name, verts, faces, smooth=True, mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [list(map(int, f)) for f in faces])
    me.update()
    if smooth:
        me.shade_smooth()
    if mat:
        me.materials.append(mat)
    return me


def obj(name, me, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = (scale, scale, scale) if np.isscalar(scale) else scale
    return link(ob)


def grid_faces(nu, nv, wrap_v=False):
    idx = np.arange(nu * nv).reshape(nu, nv)
    if wrap_v:
        idx = np.concatenate([idx, idx[:, :1]], axis=1)
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    return np.stack([a, b, c, d], axis=-1).reshape(-1, 4)


def frames(P):
    """Parallel-transport frames along a polyline."""
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    n = len(P)
    N = np.zeros_like(P)
    a = np.array([0, 0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0, 0])
    N[0] = np.cross(T[0], a); N[0] /= np.linalg.norm(N[0])
    for i in range(1, n):
        v = N[i - 1] - np.dot(N[i - 1], T[i]) * T[i]
        N[i] = v / (np.linalg.norm(v) + 1e-12)
    B = np.cross(T, N)
    return T, N, B


def sweep(P, prof, twist=None, sx=None, sy=None, caps=True, up=None):
    """Sweep a closed 2D profile (m,2) along path P (n,3). Returns V, quads, cap polygons."""
    P = np.asarray(P, float)
    n, m = len(P), len(prof)
    T, N, B = frames(P)
    if up is not None:  # keep the profile's v axis near a world direction (flat ribbons lie down)
        upv = np.asarray(up, float)
        N = upv - (T @ upv)[:, None] * T
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        B = np.cross(T, N)
        N, B = B, N
    tw = np.zeros(n) if twist is None else np.asarray(twist, float)
    sx = np.ones(n) if sx is None else np.asarray(sx, float)
    sy = np.ones(n) if sy is None else np.asarray(sy, float)
    c, s = np.cos(tw)[:, None], np.sin(tw)[:, None]
    u, v = prof[None, :, 0] * sx[:, None], prof[None, :, 1] * sy[:, None]
    ru, rv = u * c - v * s, u * s + v * c
    V = P[:, None, :] + ru[..., None] * N[:, None, :] + rv[..., None] * B[:, None, :]
    F = grid_faces(n, m, wrap_v=True)
    capF = [list(range(m))[::-1], list(range((n - 1) * m, n * m))] if caps else []
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    per = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([prof, prof[:1]]), axis=0), axis=1))])[:m]
    UV = np.stack(np.broadcast_arrays(arc[:, None], per[None, :]), -1).reshape(-1, 2)
    sweep.last_uv = UV
    return V.reshape(-1, 3), F, capF


def sweep_mesh(name, P, prof, mat=None, **kw):
    V, F, capF = sweep(P, prof, **kw)
    faces = [list(f) for f in F] + capF
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], faces)
    me.update()
    me.shade_smooth()
    if mat:
        me.materials.append(mat)
    return me


def circle(m, r=1.0, ry=None):
    t = np.linspace(0, 2 * np.pi, m, endpoint=False)
    return np.stack([r * np.cos(t), (ry or r) * np.sin(t)], axis=1)


def rounded_rect(w, h, m=16):
    """Flat ribbon cross-section: a superellipse w wide, h tall."""
    t = np.linspace(0, 2 * np.pi, m, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    e = 0.35
    return np.stack([w / 2 * np.sign(c) * np.abs(c) ** e, h / 2 * np.sign(s) * np.abs(s) ** e], axis=1)


def lathe(name, prof_rz, m=24, mat=None):
    """Solid of revolution around +Z from (r, z) samples, closed at both ends."""
    prof_rz = np.asarray(prof_rz, float)
    n = len(prof_rz)
    t = np.linspace(0, 2 * np.pi, m, endpoint=False)
    V = np.zeros((n, m, 3))
    V[..., 0] = prof_rz[:, 0:1] * np.cos(t)[None]
    V[..., 1] = prof_rz[:, 0:1] * np.sin(t)[None]
    V[..., 2] = prof_rz[:, 1:2]
    F = grid_faces(n, m, wrap_v=True)
    faces = [list(f)[::-1] for f in F] + [list(range(m)), list(range((n - 1) * m, n * m))[::-1]]
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.reshape(-1, 3).tolist(), [], faces)
    me.update(); me.shade_smooth()
    if mat:
        me.materials.append(mat)
    return me


def slab(name, poly, z0, z1, mat=None):
    """Prism from a 2D polygon (k,2) between heights z0 and z1."""
    k = len(poly)
    V = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces = [list(range(k))[::-1], list(range(k, 2 * k))]
    for i in range(k):
        j = (i + 1) % k
        faces.append([i, j, k + j, k + i])
    return mesh_py(name, V, faces, smooth=False, mat=mat)


def blob_poly(k, r, jitter, rr):
    t = np.sort(rr.uniform(0, 2 * np.pi, k))
    rad = r * (1 + rr.uniform(-jitter, jitter, k))
    return np.stack([rad * np.cos(t), rad * np.sin(t)], axis=1)


# ---------------------------------------------------------------- SEM material
AO_NODES = []


def sem_mat(name, base=0.5, bump=None, edge=1.15, floor=0.12, ao_dist=5.0):
    """Secondary-electron look. `bump(nt, links) -> height socket` adds surface detail."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links.new
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nrm = None
    if bump:
        h = bump(nt, L)
        bn = nt.nodes.new('ShaderNodeBump')
        bn.inputs['Strength'].default_value = 1.0
        bn.inputs['Distance'].default_value = 1.0
        L(h, bn.inputs['Height'])
        nrm = bn.outputs['Normal']
    lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.6
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.samples = 4; ao.inputs['Distance'].default_value = ao_dist
    AO_NODES.append(ao)
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'
    mul.inputs[1].default_value = edge; mul.inputs[2].default_value = floor
    mul2 = nt.nodes.new('ShaderNodeMath'); mul2.operation = 'MULTIPLY'
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1, 1, 1, 1)
    df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = (base, base, base, 1)
    add = nt.nodes.new('ShaderNodeAddShader')
    if nrm is not None:
        L(nrm, lw.inputs['Normal']); L(nrm, ao.inputs['Normal']); L(nrm, df.inputs['Normal'])
    L(lw.outputs['Facing'], pw.inputs[0])
    L(pw.outputs[0], mul.inputs[0])
    L(mul.outputs[0], mul2.inputs[0])
    L(ao.outputs['AO'], mul2.inputs[1])
    L(mul2.outputs[0], em.inputs['Strength'])
    L(df.outputs[0], add.inputs[0]); L(em.outputs[0], add.inputs[1])
    L(add.outputs[0], out.inputs['Surface'])
    return m


def tex_coord(nt, kind='Object'):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    return tc.outputs[kind]


def noise(nt, L, vec, scale, detail=3.0, rough=0.5):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    L(vec, n.inputs['Vector'])
    return n.outputs['Fac']


def math_node(nt, L, op, a, b=None, c=None):
    m = nt.nodes.new('ShaderNodeMath'); m.operation = op
    for i, x in enumerate((a, b, c)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            m.inputs[i].default_value = x
        else:
            L(x, m.inputs[i])
    return m.outputs[0]


def substrate(size, z=0.0, scale=0.02, base=0.32, amp=1.0):
    """Carbon tape under loose samples: dark, softly mottled."""
    def bump(nt, L):
        v = tex_coord(nt)
        return math_node(nt, L, 'MULTIPLY', noise(nt, L, v, scale, 6, 0.6), amp)
    m = sem_mat('substrate', base=base, bump=bump, edge=0.5, floor=0.05)
    me = mesh_np('substrate', np.array([[-size, -size, z], [size, -size, z], [size, size, z], [-size, size, z]]), np.array([[0, 1, 2, 3]]), smooth=False, mat=m)
    return obj('substrate', me)


# ---------------------------------------------------------------- camera, lights, render
def setup_view(focus, width, tilt=30.0, azim=-90.0, sun_az=135.0, sun_el=50.0, roll=0.0, step_focus=None, step=0, sun_energy=2.4):
    if step_focus and step in step_focus:
        focus = step_focus[step]
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cd = bpy.data.cameras.new('cam')
        cam = link(bpy.data.objects.new('cam', cd))
        sc.camera = cam
        sd = bpy.data.lights.new('sun', 'SUN')
        sd.energy = 2.4
        sd.angle = math.radians(25)
        link(bpy.data.objects.new('sun', sd))
    cd = cam.data
    cd.type = 'ORTHO'
    cd.ortho_scale = width
    t, a = math.radians(tilt), math.radians(azim)
    d = Vector((math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t)))  # camera sits along d
    dist = max(4000.0, width * 6)
    cam.location = Vector(focus) + d * dist
    q = (-d).to_track_quat('-Z', 'Y')
    cam.rotation_euler = q.to_euler()
    cam.rotation_euler.rotate_axis('Z', math.radians(roll))
    cd.clip_start = 1.0
    cd.clip_end = dist * 2.5
    sun = bpy.data.objects['sun']
    sun.data.energy = sun_energy
    sa, se = math.radians(sun_az), math.radians(sun_el)
    sdir = Vector((math.cos(se) * math.cos(sa), math.cos(se) * math.sin(sa), math.sin(se)))
    sun.rotation_euler = (-sdir).to_track_quat('-Z', 'Y').to_euler()
    for n in AO_NODES:
        n.inputs['Distance'].default_value = width * 0.06


MANIFEST = []


def render(spec, step, width):
    sc = bpy.context.scene
    png = os.path.join(OUT, f'{spec}_{step + 1}.png')
    sc.render.filepath = png
    t = time.time()
    bpy.ops.render.render(write_still=True)
    kb, q = encode(spec, step, png)
    if not args.png:
        os.remove(png)
    print(f'  {spec} step {step + 1}: width {width} um, {time.time() - t:.0f}s, {kb:.1f} KB (q{q})', flush=True)
    MANIFEST.append({'spec': spec, 'step': step + 1, 'file': f'{spec}_{step + 1}.webp', 'widthUm': width, 'kb': round(kb, 1)})


def encode(spec, step, png):
    """Raw render -> grayscale, levels stretched, faint grain, WebP under the size limit."""
    from PIL import Image
    src = Image.open(png).convert('L')
    if src.width != args.res:
        src = src.resize((args.res, args.res), Image.LANCZOS)
    im = np.asarray(src, dtype=np.float32)
    lo, hi = np.percentile(im, 0.4), np.percentile(im, 99.6)
    im = np.clip((im - lo) / max(1.0, hi - lo), 0, 1) ** 0.92 * 255
    g = np.random.default_rng(step * 31 + len(spec))
    im = np.clip(im + g.normal(0, 1.6, im.shape), 0, 255).astype(np.uint8)
    from PIL import ImageFilter
    base = Image.fromarray(im, 'L')
    webp = os.path.join(OUT, f'{spec}_{step + 1}.webp')
    # Lower the quality until the file fits; very busy images (woven fibres) also get a
    # slight softening, which costs less detail than heavy WebP blocking.
    for blur in (0, 0.5, 0.8, 1.1):
        img = base.filter(ImageFilter.GaussianBlur(blur)) if blur else base
        q = 86
        while True:
            img.save(webp, 'WEBP', quality=q, method=6)
            kb = os.path.getsize(webp) / 1024
            if kb <= args.maxkb or q <= 40:
                break
            q -= 6
        if kb <= args.maxkb:
            break
    return kb, q


# ================================================================ specimens
def build_salt():
    """Table salt: cubic NaCl grains 0.2-0.6 mm, one grain with stepped (terraced) growth faces."""
    rr = np.random.default_rng(11)
    substrate(9000, scale=0.004, amp=6.0)
    m = sem_mat('salt', base=0.32, edge=1.4, bump=lambda nt, L: math_node(nt, L, 'MULTIPLY', noise(nt, L, tex_coord(nt), 0.15, 4, 0.55), 0.25))
    cube = bpy.data.meshes.new('cube')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges], offset=0.012, segments=2, affect='EDGES')
    bm.to_mesh(cube); bm.free()
    cube.materials.append(m)
    placed = []
    hero = 420.0
    obj('hero', cube, loc=(0, 0, hero / 2), rot=(0, 0, math.radians(28)), scale=hero)
    placed.append((0, 0, hero))
    tries = 0
    while len(placed) < 22 and tries < 4000:
        tries += 1
        s = rr.uniform(200, 560)
        x, y = rr.uniform(-2600, 2600, 2)
        if widest and abs((x - 800) * math.cos(math.radians(25)) - y * math.sin(math.radians(25))) < 330:
            continue   # no pores on top of the midrib
        if any((x - px) ** 2 + (y - py) ** 2 < ((s + ps) * 0.75) ** 2 for px, py, ps in placed):
            continue
        tilt = rr.uniform(0, 0.5) if rr.random() < 0.35 else rr.uniform(0, 0.06)
        obj('g', cube, loc=(x, y, s / 2 + s * 0.2 * tilt), rot=(tilt, rr.uniform(-0.1, 0.1), rr.uniform(0, math.pi)), scale=s)
        placed.append((x, y, s))
    # terraces on the hero's top face (growth steps, 2-4 um tall), rotated with the cube
    c, s_ = math.cos(math.radians(28)), math.sin(math.radians(28))
    def rot(p):
        return [(x * c - y * s_, x * s_ + y * c) for x, y in p]
    half = hero / 2 - hero * 0.012
    z = hero
    inset = 0.0
    for i in range(7):
        inset += rr.uniform(5, 16) if i else rr.uniform(3, 6)
        h = rr.uniform(1.5, 3.5)
        a = half - inset
        jag = [(a + rr.uniform(-1.5, 0), -a), (a, a - rr.uniform(0, 3)), (-a, a), (-a, -a)]
        obj('terrace', slab('t', rot(jag), z - 0.2, z + h, m))
        z += h
    # cubic debris: on the hero top near the focus corner, and on the tape
    corner = np.array(rot([(half, -half)])[0])
    for i in range(9):
        d = rr.uniform(1.5, 7)
        off = corner + np.array(rot([(-rr.uniform(6, 140), rr.uniform(6, 140))])[0])
        obj('chip', cube, loc=(off[0], off[1], z + d / 2 - 0.3), rot=(rr.uniform(0, 0.4), rr.uniform(0, 0.4), rr.uniform(0, 6.28)), scale=d)
    for i in range(260):
        d = rr.uniform(4, 45)
        x, y = rr.uniform(-4500, 4500, 2)
        obj('dust', cube, loc=(x, y, d / 2), rot=(0, 0, rr.uniform(0, 6.28)), scale=d)
    focus = (corner[0] - 6, corner[1] + 6, hero - 2)
    return focus, dict(tilt=38, azim=-20, sun_az=110, sun_el=45, sun_energy=1.3)


def hair_mesh(name, length, R, x0, mat, dx_fine=0.4, dx_coarse=4.0, fine_half=220, ntheta=96, bend=0.0, seed=0):
    p = 6.5    # visible scale-edge spacing, um
    h = 0.75   # step height at each scale edge
    xs = np.concatenate([np.arange(-length / 2, x0 - fine_half, dx_coarse), np.arange(x0 - fine_half, x0 + fine_half, dx_fine), np.arange(x0 + fine_half, length / 2 + 0.1, dx_coarse)])
    th = np.linspace(0, 2 * np.pi, ntheta, endpoint=False)
    X, TH = np.meshgrid(xs, th, indexing='ij')
    phi = 2.1 * np.sin(0.37 * X / p + seed) + 1.3 * np.sin(0.13 * X / p + 2 * seed)
    u = X / p + 0.32 * np.sin(3 * TH + phi) + 0.12 * np.sin(7 * TH + 0.5 * phi)
    saw = u - np.floor(u)
    r = R * (1 + 0.04 * np.sin(2 * TH + 0.2)) + h * saw ** 1.3
    cy = bend * np.sin(X / length * np.pi)
    V = np.stack([X, cy + r * np.cos(TH), r * np.sin(TH)], axis=-1)
    F = grid_faces(len(xs), ntheta, wrap_v=True)
    return mesh_np(name, V.reshape(-1, 3), F, mat=mat)


def build_hair():
    """Human hair: ~80 um shaft, cuticle of overlapping scales with wavy edges."""
    substrate(9000, scale=0.004, amp=6.0)
    m = sem_mat('hair', base=0.5, bump=lambda nt, L: math_node(nt, L, 'MULTIPLY', noise(nt, L, tex_coord(nt), 0.4, 3, 0.5), 0.08))
    R = 40.0
    hm = hair_mesh('hair', 4200, R, 0.0, m, bend=120)
    obj('hair', hm, loc=(0, 0, R))
    h2 = hair_mesh('hair2', 4200, 36, 0.0, m, dx_fine=3, fine_half=1, ntheta=48, bend=-200, seed=1.7)
    obj('hair2', h2, loc=(150, -400, 36 + 2 * R + 2), rot=(0, 0, math.radians(58)))
    h3 = hair_mesh('hair3', 4200, 44, 0.0, m, dx_fine=3, fine_half=1, ntheta=48, bend=80, seed=3.1)
    obj('hair3', h3, loc=(-300, 700, 44), rot=(0, 0, math.radians(-14)))
    focus = (0, 120 * 0 + 0, 2 * R - 6)
    return focus, dict(tilt=28, azim=-100, sun_az=160, sun_el=50)


def build_hooks():
    """Hook side of hook-and-loop tape: cut monofilament hooks rising from a woven backing."""
    rr = np.random.default_rng(5)
    m = sem_mat('nylon', base=0.5, bump=lambda nt, L: math_node(nt, L, 'MULTIPLY', noise(nt, L, tex_coord(nt), 0.08, 2, 0.4), 1.0))
    # hook path in the xz plane: stem, then an arc that curls back down
    def hook_path(H, rc, sweep_deg, lean):
        s = np.linspace(0, H, 40)
        stem = np.stack([lean * (s / H) ** 2, np.zeros_like(s), s], axis=1)
        a = np.linspace(0, math.radians(sweep_deg), 60)[1:]
        cx = stem[-1, 0] + rc
        arc = np.stack([cx - rc * np.cos(a), np.zeros_like(a), H + rc * np.sin(a)], axis=1)
        return np.concatenate([stem, arc])
    variants = []
    for i in range(6):
        P = hook_path(rr.uniform(780, 980), rr.uniform(150, 200), rr.uniform(190, 225), rr.uniform(-40, 40))
        prof = circle(20, 92, 80)
        variants.append(sweep_mesh(f'hook{i}', P, prof, mat=m))
    # hero hook at origin; others on a grid with jitter
    hero = obj('hero', variants[0], loc=(0, 0, 60), rot=(0, 0, 0))
    for ix in range(-19, 20):
        for iy in range(-26, 27):
            if ix == 0 and iy == 0:
                continue
            x = ix * 560 + rr.uniform(-60, 60) + (iy % 2) * 280
            y = iy * 470 + rr.uniform(-50, 50)
            rz = (0 if (ix + iy) % 2 == 0 else math.pi) + rr.uniform(-0.35, 0.35)
            obj('h', variants[rr.integers(0, 6)], loc=(x, y, 60), rot=(rr.uniform(-0.15, 0.15), rr.uniform(-0.15, 0.15), rz))
    # woven backing: flat yarn bundles, plain weave
    yarn = []
    s = 420.0
    xs = np.linspace(-14000, 14000, 700)
    prof = rounded_rect(360, 110, 16)
    me_x = sweep_mesh('warp', np.stack([xs, np.zeros_like(xs), 40 * np.cos(np.pi * xs / s)], 1), prof, mat=m, up=(0, 0, 1))
    for j in range(-32, 33):
        obj('warp', me_x, loc=((s if j % 2 else 0), j * s, 60))
    me_y = sweep_mesh('weft', np.stack([np.zeros_like(xs), xs, -40 * np.cos(np.pi * xs / s)], 1), prof, mat=m, up=(0, 0, 1))
    for i in range(-30, 31):
        ob = obj('weft', me_y, loc=(i * s, (s if i % 2 else 0), 60))
    # tip of the hero hook: last path point
    P = np.asarray([v.co[:] for v in variants[0].vertices]).reshape(-1, 20, 3)
    tip = P[-1].mean(axis=0)
    crest = P[np.argmax(P[:, :, 2].mean(1))].mean(0)
    f = (tip + crest) / 2
    focus = (f[0], f[1], f[2] + 60)
    return focus, dict(tilt=55, azim=-70, sun_az=140, sun_el=50)


def build_pollen():
    """Sunflower pollen: spiny grain ~25 um (35 um with spines), three furrows, perforated wall."""
    rr = np.random.default_rng(3)
    substrate(1200, scale=0.08, amp=0.4)
    def perf(nt, L):
        vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 2.2
        L(tex_coord(nt), vor.inputs['Vector'])
        return math_node(nt, L, 'MULTIPLY', math_node(nt, L, 'POWER', vor.outputs['Distance'], 0.5), 0.12)
    m = sem_mat('pollen', base=0.55, bump=perf)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=6, radius=12.5)
    me = bpy.data.meshes.new('grain')
    bm.to_mesh(me); bm.free()
    V = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', V)
    V = V.reshape(-1, 3)
    n = V / np.linalg.norm(V, axis=1, keepdims=True)
    # three furrows (colpi) along meridians 120 degrees apart
    lon = np.arctan2(n[:, 1], n[:, 0])
    dent = np.zeros(len(V))
    for k in range(3):
        d = np.angle(np.exp(1j * (lon - k * 2 * np.pi / 3)))
        band = np.exp(-(d / 0.09) ** 2) * np.clip(1 - np.abs(n[:, 2]) / 0.8, 0, 1) ** 0.6
        dent = np.maximum(dent, band)
    V = n * (12.5 - 1.1 * dent + 0.15 * np.sin(9 * n[:, 0]) * np.sin(7 * n[:, 1]))[:, None]
    me.vertices.foreach_set('co', V.ravel())
    me.update(); me.shade_smooth(); me.materials.append(m)
    spine = lathe('spine', [(1.45, -0.4), (1.4, 0.0), (1.05, 0.5), (0.62, 1.2), (0.36, 2.2), (0.2, 3.2), (0.08, 4.1), (0.01, 4.5)], m=20, mat=m)
    # grain object with spines parented (so copies move together)
    def make_grain(name, loc, rot, scale):
        g = obj(name, me, loc=loc, rot=rot, scale=scale)
        return g
    def add_spines(parent):
        N = 130
        i = np.arange(N) + 0.5
        phi = np.arccos(1 - 2 * i / N)
        th = np.pi * (1 + 5 ** 0.5) * i
        pts = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)
        pts += rr.normal(0, 0.04, pts.shape)
        pts /= np.linalg.norm(pts, axis=1, keepdims=True)
        lon = np.arctan2(pts[:, 1], pts[:, 0])
        for p, lo in zip(pts, lon):
            near = min(abs(np.angle(np.exp(1j * (lo - k * 2 * np.pi / 3)))) for k in range(3))
            if near < 0.16 and abs(p[2]) < 0.8:
                continue
            s = rr.uniform(0.9, 1.08)
            ob = obj('sp', spine, loc=tuple(p * 12.2), scale=s)
            ob.rotation_euler = Vector(p).to_track_quat('Z', 'Y').to_euler()
            ob.parent = parent
    hero = make_grain('hero', (0, 0, 15.5), (0.4, 0.2, 0.3), 1.0)
    add_spines(hero)
    placed = [(0, 0)]
    for k in range(13):
        for _ in range(200):
            x, y = rr.uniform(-120, 120, 2)
            if all((x - a) ** 2 + (y - b) ** 2 > 33 ** 2 for a, b in placed):
                break
        placed.append((x, y))
        s = rr.uniform(0.9, 1.08)
        g = make_grain('g', (x, y, 15.5 * s), tuple(rr.uniform(0, 6.28, 3)), s)
        add_spines(g)
    bpy.context.view_layer.update()
    # focus on a spine near the top of the hero grain, as seen by the camera
    best = None
    for ob in hero.children:
        wp = ob.matrix_world.translation
        if best is None or wp.z > best.z:
            best = wp.copy()
    top = Vector((0, 0, 15.5)) + (best - Vector((0, 0, 15.5))).normalized() * 13.5
    return tuple(top), dict(tilt=35, azim=-80, sun_az=150, sun_el=50)


def scale_mesh(name, L=100.0, W=50.0, mat=None, teeth=4, dx=0.2, dy=0.8, ridge=1.6, ridged=True, shingle=False):
    """One wing scale. shingle=True (wide views): rounded shoulders, deeper teeth on the tip and a
    tip that lifts off the wing, so the rows read as overlapping roof shingles."""
    if not ridged:
        dx = 1.0
    xs = np.arange(-W / 2, W / 2 + 1e-6, dx)
    ys = np.arange(0, L + 1e-6, dy)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    # outline: narrow socket at the base, widening, toothed tip
    hw = W / 2 * np.clip(0.22 + 0.78 * np.sin(np.clip(Y / (L * 0.32), 0, 1) * np.pi / 2), 0, 1)
    if shingle:
        u = np.clip(2 * X / W, -1, 1)
        tip = L - 0.42 * L * (1 - np.sqrt(np.clip(1 - u ** 2, 0, 1))) - 0.05 * L * np.abs(np.sin(teeth * np.pi * (X / W + 0.5)))
    else:
        tip = L - 5.5 * np.abs(np.sin(teeth * np.pi * (X / W + 0.5))) - 4 * (2 * X / W) ** 2
    inside = (np.abs(X) <= hw) & (Y <= tip)
    Z = (0.7 * np.maximum(0, np.cos(2 * np.pi * X / ridge)) ** 3 * np.clip(Y / 8, 0, 1)) if ridged else 0 * X
    Z = Z + 2.5 * (1 - (2 * X / W) ** 2) + 0.16 * Y + (16.0 * (Y / L) ** 4 if shingle else 3.0 * (Y / L) ** 3)
    V = np.stack([X, Y, Z], -1).reshape(-1, 3)
    F = grid_faces(len(xs), len(ys))
    keep = inside.ravel()[F].all(axis=1)
    F = F[keep]
    used = np.unique(F)
    remap = -np.ones(len(V), dtype=np.int64); remap[used] = np.arange(len(used))
    me = mesh_np(name, V[used], remap[F], mat=mat)
    return me


def build_wing(step=0):
    """Butterfly wing: rows of overlapping scales like roof shingles; each scale has fine lengthwise ridges and cross-ribs."""
    rr = np.random.default_rng(9)
    def ribs(nt, L):
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Y'
        w.inputs['Scale'].default_value = 2 * math.pi / (20 * 0.62)
        w.inputs['Distortion'].default_value = 0.6
        L(tex_coord(nt), w.inputs['Vector'])
        return math_node(nt, L, 'MULTIPLY', w.outputs['Fac'], 0.06)
    m = sem_mat('scale', base=0.52, bump=ribs if step < 3 else None)
    wide = step >= 2   # zoom steps 3 and 4: whole scales in rows, like roof shingles
    cover = scale_mesh('cover', 100, 52, m, ridged=step < 3, shingle=wide)
    ground = scale_mesh('ground', 82, 44, m, teeth=3, ridge=1.1, ridged=step < 3, shingle=wide)
    hero = None
    colw = 42 if wide else 48   # wide views: neighbours overlap at the sides, so each row is one scalloped edge
    for r in (range(-24, 26) if step >= 3 else range(-16, 18)):
        y = r * 56
        z = -r * 2.2
        offs = (r % 2) * colw / 2
        for c in range(-26, 27):
            x = c * colw + offs + rr.uniform(-3, 3)
            rot = (rr.uniform(-0.03, 0.03), rr.uniform(-0.05, 0.05), rr.uniform(-0.06, 0.06) * (2.0 if wide else 1.0))
            sz = rr.uniform(0.92, 1.08) if wide else 1.0
            ob = obj('c', cover, loc=(x, y + rr.uniform(-3, 3), z), rot=rot, scale=sz)
            ob2 = obj('g', ground, loc=(x + colw / 2, y + 8, z - 3.0), rot=rot)
            if r == 0 and c == 0:
                hero = ob
    mem = sem_mat('membrane', base=0.2, edge=0.3, floor=0.02)
    me = mesh_np('membrane', np.array([[-3000, -3000, -60], [3000, -3000, -60], [3000, 3000, -60], [-3000, 3000, -60]]), np.array([[0, 1, 2, 3]]), smooth=False, mat=mem)
    obj('membrane', me)
    # focus on the exposed part of the hero scale (its tip half is not covered by the next row)
    focus = (6.0, 70.0, 0.16 * 70 + 2.5 + 3.0 * 0.343 + 0.4)
    return focus, dict(tilt=35, azim=-90, sun_az=-120, sun_el=40)


def stoma_mesh(name, mat):
    """Two kidney-shaped guard cells around a slit pore, ~30 um long."""
    parts_V, parts_F = [], []
    a = np.linspace(-0.92 * np.pi / 2, 0.92 * np.pi / 2, 48)
    for side in (-1, 1):
        P = np.stack([side * (0.3 + 4.6 * np.cos(a)), 14 * np.sin(a), np.zeros_like(a)], 1)
        prof = circle(18, 4.0, 3.0)
        rad = 0.55 + 0.45 * np.cos(a) ** 0.5
        V, F, capF = sweep(P, prof, sx=rad, sy=rad)
        parts_V.append(V); parts_F.append((F, capF))
    verts, faces = [], []
    for V, (F, capF) in zip(parts_V, parts_F):
        o = len(verts)
        verts += V.tolist()
        faces += [[o + i for i in f] for f in F] + [[o + i for i in f] for f in capF]
    me = mesh_py(name, verts, faces, mat=mat)
    # dark slit for the pore, drawn just under the guard cells
    dark = bpy.data.materials.new('pore'); dark.use_nodes = True
    dark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 0, 1)
    dark.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    me.materials.append(dark)
    t = np.linspace(0, 2 * np.pi, 24, endpoint=False)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me)
    vs = [bm.verts.new((1.6 * math.cos(a), 11.0 * math.sin(a), 0.6)) for a in t]
    f = bm.faces.new(vs); f.material_index = 1; f.smooth = False
    bm.to_mesh(me); bm.free()
    return me


def build_leaf(step=0):
    """Leaf surface: jigsaw-shaped pavement cells, stomata (guard-cell pairs), and raised veins.
    The widest view (step 4) keeps the veins low and soft and the midrib a broad ridge in the
    surface, so the picture reads as a leaf surface dotted with pores."""
    rr = np.random.default_rng(4)
    widest = step >= 3
    def cells(nt, L):
        v = tex_coord(nt)
        # warp coordinates with noise so cell walls wiggle like jigsaw pieces
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.075; nz.inputs['Detail'].default_value = 1.5
        L(v, nz.inputs['Vector'])
        sub = nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'
        sub.inputs[1].default_value = (0.5, 0.5, 0.5)
        L(nz.outputs['Color'], sub.inputs[0])
        sc_ = nt.nodes.new('ShaderNodeVectorMath'); sc_.operation = 'SCALE'; sc_.inputs['Scale'].default_value = 22.0
        L(sub.outputs[0], sc_.inputs[0])
        add = nt.nodes.new('ShaderNodeVectorMath'); add.operation = 'ADD'
        L(v, add.inputs[0]); L(sc_.outputs[0], add.inputs[1])
        vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 1 / 40.0
        L(add.outputs[0], vor.inputs['Vector'])
        f1 = nt.nodes.new('ShaderNodeTexVoronoi'); f1.inputs['Scale'].default_value = 1 / 40.0
        L(add.outputs[0], f1.inputs['Vector'])
        wall = math_node(nt, L, 'MULTIPLY', math_node(nt, L, 'POWER', math_node(nt, L, 'MINIMUM', math_node(nt, L, 'MULTIPLY', vor.outputs['Distance'], 7.0), 1.0), 0.6), 2.2)
        dome = math_node(nt, L, 'MULTIPLY', math_node(nt, L, 'SUBTRACT', 1.0, math_node(nt, L, 'POWER', f1.outputs['Distance'], 2.0)), 3.0)
        # veins: a coarse network of broad, soft ridges
        vor2 = nt.nodes.new('ShaderNodeTexVoronoi'); vor2.feature = 'DISTANCE_TO_EDGE'; vor2.inputs['Scale'].default_value = 1 / 950.0
        L(v, vor2.inputs['Vector'])
        d7 = math_node(nt, L, 'MULTIPLY', vor2.outputs['Distance'], 3.0 if widest else 6.0)
        r = math_node(nt, L, 'MAXIMUM', math_node(nt, L, 'SUBTRACT', 1.0, math_node(nt, L, 'MULTIPLY', d7, d7)), 0.0)
        vein = math_node(nt, L, 'MULTIPLY', math_node(nt, L, 'POWER', r, 1.5), 9.0 if widest else 40.0)
        fine = math_node(nt, L, 'MULTIPLY', noise(nt, L, v, 0.7, 2, 0.5), 0.25)
        return math_node(nt, L, 'ADD', math_node(nt, L, 'ADD', math_node(nt, L, 'ADD', wall, dome), vein), fine)
    m = sem_mat('leaf', base=0.5, bump=cells, edge=1.0)
    me = mesh_np('leaf', np.array([[-5000, -5000, 0], [5000, -5000, 0], [5000, 5000, 0], [-5000, 5000, 0]]), np.array([[0, 1, 2, 3]]), smooth=False, mat=m)
    obj('leaf', me)
    # a large vein (midrib side branch) crossing the widest view only
    t = np.linspace(-6000, 6000, 300)
    P = np.stack([800 + t * math.sin(math.radians(25)), t * math.cos(math.radians(25)), np.zeros_like(t)], 1)
    if widest:
        # a broad, low ridge sunk into the surface, not a tube lying on it
        obj('midrib', sweep_mesh('midrib', P, circle(40, 520, 70), mat=m), loc=(0, 0, -48))
    else:
        obj('midrib', sweep_mesh('midrib', P, circle(40, 170, 70), mat=m))
    sm = stoma_mesh('stoma', m)
    obj('hero', sm, loc=(0, 0, 0.4), rot=(0, 0, math.radians(20)))
    placed = [(0, 0)]
    for _ in range(9000):
        if len(placed) > (3400 if widest else 1700):
            break
        x, y = rr.uniform(-2600, 2600, 2)
        if widest and abs((x - 800) * math.cos(math.radians(25)) - y * math.sin(math.radians(25))) < 330:
            continue   # no pores on top of the midrib
        if (x * x + y * y) < 60 ** 2:
            continue
        # keep the sample sparse near the focus so the jigsaw cells stay visible
        placed.append((x, y))
        obj('s', sm, loc=(x, y, 0.4), rot=(0, 0, rr.uniform(0, 6.28)), scale=rr.uniform(0.85, 1.1))
    return (0, 0, 2), dict(tilt=25, azim=-90, sun_az=140, sun_el=50)


def ribbon_path(rr, start, ang, length, step, wander=0.004, z0=0.0, zamp=0.0):
    n = max(3, int(length / step))
    pts = np.zeros((n, 3))
    p = np.array(start, float)
    a = ang
    for i in range(n):
        pts[i] = p
        a += rr.normal(0, wander * step ** 0.5)
        p = p + step * np.array([math.cos(a), math.sin(a), 0])
    pts[:, 2] = z0 + zamp * np.sin(np.linspace(0, rr.uniform(2, 6), n) + rr.uniform(0, 6))
    return pts


def build_paper():
    """Paper: a felted mat of flat cellulose fibre ribbons (~30 um wide), with a torn edge."""
    rr = np.random.default_rng(21)
    substrate(9000, z=-40, scale=0.003, amp=3.0)
    def stri(nt, L):
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Y'
        w.inputs['Scale'].default_value = 2 * math.pi / (20 * 1.8); w.inputs['Distortion'].default_value = 1.5; w.inputs['Detail'].default_value = 2
        L(tex_coord(nt, 'UV'), w.inputs['Vector'])
        return math_node(nt, L, 'MULTIPLY', w.outputs['Fac'], 0.25)
    m = sem_mat('fibre', base=0.55, bump=stri)
    def edge_y(x):
        return 1400 + 220 * np.sin(x / 700) + 120 * np.sin(x / 230 + 1) + 60 * np.sin(x / 90)
    acc = Acc()
    def add_fibre(P, w, t, twist=None):
        prof = rounded_rect(w, t, 10)
        V, F, capF = sweep(P, prof, twist=twist, up=(0, 0, 1))
        acc.add(V, F, capF, sweep.last_uv)
        return len(P)
    nf = 0
    for i in range(1500):
        x0, y0 = rr.uniform(-5000, 5000), rr.uniform(-5000, 1700)
        if y0 > edge_y(x0):
            continue
        L_ = rr.uniform(900, 3000)
        a = rr.uniform(0, 2 * np.pi)
        near = abs(x0) < 900 and abs(y0 - 700) < 900
        step = 6 if near else 30
        P = ribbon_path(rr, (x0, y0, 0), a, L_, step, wander=0.004, z0=i * 0.022, zamp=3)
        # stop fibres that run past the torn edge after a short overhang
        out = P[:, 1] > edge_y(P[:, 0]) + rr.uniform(20, 260)
        if out.any():
            P = P[:max(3, int(np.argmax(out)))]
        tw = np.cumsum(rr.normal(0, 0.02, len(P))) if near else None
        add_fibre(P, rr.uniform(24, 38), rr.uniform(4, 7), twist=tw)
        nf += 1
    # fibrils peeling off fibres near the focus
    for k in range(40):
        x0, y0 = rr.uniform(-60, 60), rr.uniform(640, 760)
        P = ribbon_path(rr, (x0, y0, 34), rr.uniform(0, 6.28), rr.uniform(20, 90), 1.0, wander=0.05, z0=33.5, zamp=1.5)
        add_fibre(P, 0.9, 0.6)
    me = acc.build('paper', m)
    obj('paper', me)
    print('  paper fibres', nf, 'verts', acc.n)
    return (0, 700, 34), dict(tilt=30, azim=-90, sun_az=135, sun_el=50)


def yarn_template(name, rr, mat, s, A, nfib=44, ry=170, rz=80):
    """One plain-weave repeat (length 2s) of a twisted yarn made of flat, twisted cotton fibres."""
    xs = np.arange(0, 4 * s + 1e-6, 4.0)
    acc = Acc()
    pitch = 4 * s      # outer fibres sit about 30 degrees to the yarn axis
    for k in range(nfib):
        rho = math.sqrt(rr.uniform(0.04, 1.0))
        ph = rr.uniform(0, 2 * np.pi)
        ang = ph + 2 * np.pi * xs / pitch
        y = rho * ry * np.cos(ang)
        z = rho * rz * np.sin(ang) + A * np.cos(np.pi * xs / s)
        P = np.stack([xs, y, z], 1)
        conv = rr.uniform(0, 6.28) + np.pi * xs / (4 * s / 12) * rr.choice([-1, 1])
        prof = rounded_rect(rr.uniform(15, 21), rr.uniform(4, 6), 10)
        V, F, capF = sweep(P, prof, twist=conv, caps=False)
        acc.add(V, F, (), sweep.last_uv)
    return acc.build(name, mat)


def build_cotton():
    """Cotton fabric: plain weave of yarns, each a twist of flat, twisted fibres about 20 um wide."""
    rr = np.random.default_rng(13)
    substrate(9000, z=-400, scale=0.003, amp=2.0)
    def stri(nt, L):
        return math_node(nt, L, 'MULTIPLY', noise(nt, L, tex_coord(nt), 1.1, 3, 0.6), 0.3)
    m = sem_mat('cotton', base=0.55, bump=stri)
    s, A = 460.0, 95.0
    tmpl = yarn_template('yarn', rr, m, s, A)
    for j in range(-9, 10):
        for i in range(-5, 5):
            # warp yarn j along x; neighbours flip phase so they cross over and under
            x = i * 4 * s + (s if j % 2 else 0)
            obj('w', tmpl, loc=(x, j * s, 0))
    for i in range(-9, 10):
        for j in range(-5, 5):
            y = j * 4 * s + (0 if i % 2 else s)
            obj('f', tmpl, loc=(i * s, y, 0), rot=(0, 0, math.pi / 2))
    # stray fibres
    for k in range(30):
        x0, y0 = rr.uniform(-3000, 3000, 2)
        P = ribbon_path(rr, (x0, y0, 140), rr.uniform(0, 6.28), rr.uniform(300, 1200), 6, wander=0.01, z0=150, zamp=40)
        conv = np.pi * np.arange(len(P)) * 6 / 150
        me = sweep_mesh('stray', P, rounded_rect(18, 5, 10), mat=m, twist=conv)
        obj('stray', me)
    # focus: the crest of a warp yarn (j=0) where it rides over a weft
    return (0.0, 0.0, A + 82.0), dict(tilt=35, azim=-75, sun_az=140, sun_el=50)


def flake_mesh(name, rr, mat, r=6.0, layers=6, t=0.45):
    verts, faces = [], []
    z = 0.0
    rad = r
    cx = cy = 0.0
    for i in range(layers):
        poly = blob_poly(int(rr.integers(6, 10)), rad, 0.3, rr) + np.array([cx, cy])
        k = len(poly)
        o = len(verts)
        verts += [(x, y, z) for x, y in poly] + [(x, y, z + t) for x, y in poly]
        faces.append(list(range(o, o + k))[::-1]); faces.append(list(range(o + k, o + 2 * k)))
        for a in range(k):
            b = (a + 1) % k
            faces.append([o + a, o + b, o + k + b, o + k + a])
        z += t * 0.97
        rad *= rr.uniform(0.72, 0.92)
        cx += rr.uniform(-0.25, 0.25) * rad; cy += rr.uniform(-0.25, 0.25) * rad
    return mesh_py(name, verts, faces, smooth=False, mat=mat)


def build_graphite(step=0):
    """Pencil tip: a graphite core sharpened to a point in a wood cone; up close, stacked graphite flakes.
    A sharpener cuts wood and graphite at one angle, so the wood cone and the graphite point share it.
    The widest view (step 4) shows the whole sharpened cone and the start of the round pencil body."""
    rr = np.random.default_rng(17)
    substrate(60000, z=-3600, scale=0.0004, amp=4.0) if step >= 3 else substrate(30000, z=-1100, scale=0.0008, amp=4.0)
    # graphite conducts, so in an SEM it looks darker than the wood around it (shown in the widest view)
    mg = sem_mat('graphite', base=0.3 if step >= 3 else 0.5, bump=lambda nt, L: math_node(nt, L, 'MULTIPLY', noise(nt, L, tex_coord(nt), 0.05, 5, 0.65), 6.0))
    def grain(nt, L):
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'X'
        w.inputs['Scale'].default_value = 0.004; w.inputs['Distortion'].default_value = 12; w.inputs['Detail'].default_value = 4
        L(tex_coord(nt), w.inputs['Vector'])
        return math_node(nt, L, 'MULTIPLY', w.outputs['Fac'], 25.0)
    mw = sem_mat('wood', base=0.45, bump=grain)
    # pencil axis along +x, tip at x=0. Graphite core radius 1000 um, cone half-angle ~13 deg.
    k = math.tan(math.radians(13))
    tip_r = 140.0
    xg = np.linspace(-9000, 0, 160)
    rg = np.clip(-xg * k + tip_r, 0, 1000)
    prof = [(0.0, -9000)]
    # lathe expects (r, z): use z as axis, then rotate so z -> +x
    core = [(r, z) for r, z in zip(rg, xg)]
    cap = [(tip_r * math.cos(a), tip_r * math.sin(a) * 0.8) for a in np.linspace(0, math.pi / 2 * 0.97, 10)][1:]
    core += cap
    me_c = lathe('core', core, m=96, mat=mg)
    obj('core', me_c, rot=(0, math.pi / 2, 0))
    # wood cone starts where the core is 1000 um wide (x ~ -3700) and widens, at the same angle, to 3500 um
    x0 = -(1000 - tip_r) / k
    xw = np.linspace(x0 - 22000, x0, 160)
    rw = np.clip(1000 + (x0 - xw) * k, 1000, 3500)
    me_w = lathe('wood', list(zip(rw, xw)), m=96, mat=mw)
    obj('wood', me_w, rot=(0, math.pi / 2, 0))
    # flakes over the top of the core near the focus
    fx = -260.0
    def surf(x, a):
        r = max(tip_r, -x * k + tip_r)
        nv = np.array([math.sin(math.radians(13)), math.cos(math.radians(13)) * math.sin(a), math.cos(math.radians(13)) * math.cos(a)])
        return np.array([x, r * math.sin(a), r * math.cos(a)]), nv
    flakes = [flake_mesh(f'fl{i}', rr, mg, r=rr.uniform(3, 9), layers=int(rr.integers(3, 7))) for i in range(8)]
    hero = flake_mesh('hero', np.random.default_rng(99), mg, r=6.0, layers=7, t=0.5)
    p, nrm = surf(fx, 0.0)
    ob = obj('hero', hero, loc=tuple(p + nrm * 0.2))
    ob.rotation_euler = Vector(nrm).to_track_quat('Z', 'Y').to_euler()
    for i in range(2600):
        x = fx + rr.normal(0, 160)
        if x > -20 or x < -1600:
            continue
        a = rr.normal(0, 0.55)
        p, nrm = surf(x, a)
        if np.linalg.norm(p[:1] - fx) < 9 and abs(a) < 0.03:
            continue
        sc_ = rr.uniform(0.6, 2.6) if abs(x - fx) > 30 else rr.uniform(0.5, 1.4)
        ob = obj('f', flakes[rr.integers(0, 8)], loc=tuple(p - nrm * 0.3), scale=sc_)
        q = Vector(nrm + rr.normal(0, 0.35, 3)).normalized().to_track_quat('Z', 'Y')
        ob.rotation_euler = q.to_euler()
        ob.rotation_euler.rotate_axis('Z', rr.uniform(0, 6.28))
    p, nrm = surf(fx, 0.0)
    return tuple(p + nrm * 1.5), dict(tilt=35, azim=-90, sun_az=150, sun_el=50, step_focus={3: (-8200.0, 0.0, 900.0)})


SPECIMENS = {
    #            builder,        widths for zoom steps 1..4 (closest first), micrometres
    'salt':     (build_salt,     [40, 150, 600, 2400]),
    'hair':     (build_hair,     [30, 120, 500, 2500]),
    'hooks':    (build_hooks,    [400, 1200, 3600, 12000]),
    'pollen':   (build_pollen,   [8, 22, 55, 220]),
    'wing':     (build_wing,     [10, 50, 250, 1000]),
    'leaf':     (build_leaf,     [25, 100, 400, 3000]),
    'paper':    (build_paper,    [40, 200, 1000, 5000]),
    'cotton':   (build_cotton,   [30, 150, 800, 4000]),
    'graphite': (build_graphite, [10, 50, 400, 18000]),
}

# Where each simulated look comes from (what the real thing looks like under an SEM).
DESCRIPTION_SOURCES = {
    'salt': ['https://www.encyclopedia.pub/image/1409', 'https://scaleofuniverse.com/universe/grain-of-salt'],
    'hair': ['https://wellcomecollection.org/works/wxgqyf66', 'https://bionumbers.hms.harvard.edu/bionumber.aspx?id=114259'],
    'hooks': ['https://hackaday.com/2018/04/19/mechanisms-hook-and-loop-fasteners', 'https://www.invent.org/blog/inventors/walk-in-the-woods-velcro'],
    'pollen': ['https://indianbotsoc.org/assets/upload/uploaded/80-83%20Brinda%20Shukla%20and%20S.%20N.%20Gupta.pdf', 'https://microcosmos.foldscope.com/post/tGVj42l3nNHJosn3EtBP'],
    'wing': ['https://pubs.rsc.org/en/content/articlehtml/2020/fd/d0fd00038h', 'https://phys.org/news/2024-06-moments-butterfly-scale-formation.pdf'],
    'leaf': ['https://mmegias.webs2.uvigo.es/02-english/1-vegetal/v-imagenes-grandes/proteccion_estomas.php', 'https://faculty.csbsju.edu/SSAUPE/biol327/Lab/stomata/stoma_lab_size.htm'],
    'paper': ['https://www.britannica.com/technology/paper', 'https://www.britannica.com/science/wood-plant-tissue/Microstructure'],
    'cotton': ['https://cameo.mfa.org/wiki/Cotton'],
    'graphite': ['https://micro.org.au/inner-space/pencil-lead/'],
}


def write_manifest():
    imgs = []
    for spec, (_, widths) in SPECIMENS.items():
        for st, w in enumerate(widths):
            f = f'{spec}_{st + 1}.webp'
            if not os.path.exists(os.path.join(OUT, f)):
                continue
            imgs.append({'specimen': spec, 'step': st + 1, 'file': f, 'widthUm': w, 'simulated': True,
                         'descriptionSources': DESCRIPTION_SOURCES[spec]})
    man = {
        'note': 'Simulated SEM-style renders from scripts/render-specimens.py (Blender, Cycles). Not real micrographs. '
                'To use real images: replace the file, set simulated to false and set widthUm to the real width shown.',
        'maxKB': args.maxkb,
        'images': imgs,
    }
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=1)
    print('manifest:', len(imgs), 'images')


if __name__ == '__main__' and args.encode_only:
    for spec in [s for s in args.only.split(',') if s] or list(SPECIMENS):
        for st in STEPS:
            png = os.path.join(OUT, f'{spec}_{st + 1}.png')
            if os.path.exists(png):
                kb, q = encode(spec, st, png)
                print(f'  {spec} step {st + 1}: {kb:.1f} KB (q{q})')
    sys.exit(0)

if __name__ == '__main__' and args.manifest_only:
    write_manifest()
    sys.exit(0)

if __name__ == '__main__':
    only = [s for s in args.only.split(',') if s] or list(SPECIMENS)
    t0 = time.time()
    import inspect
    for spec in only:
        builder, widths = SPECIMENS[spec]
        per_step = 'step' in inspect.signature(builder).parameters
        built = None
        for st in STEPS:
            if built is None or per_step:
                AO_NODES.clear()
                reset()
                tb = time.time()
                focus, view = builder(st) if per_step else builder()
                built = True
                print(f'{spec}: built in {time.time() - tb:.0f}s', flush=True)
            setup_view(focus, widths[st], step=st, **view)
            render(spec, st, widths[st])
    with open(os.path.join(OUT, '_render_log.json'), 'w') as f:
        json.dump(MANIFEST, f, indent=1)
    write_manifest()
    print(f'done in {time.time() - t0:.0f}s')
