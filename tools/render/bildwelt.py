# Bildwelt 2.0 – fotorealistische Visualisierungen (Blender 4.5, Cycles).
# Alle Motive sind modellierte Beispielanlagen: keine gebaute Anlage, keine Herstellerprodukte, keine Logos.
# Aufruf: blender -b --python tools/render/bildwelt.py -- --shot hero --out <png> [--w 3200 --h 1800 --samples 192]
import bpy, bmesh, math, random, sys, argparse
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--shot', default='hero')
ap.add_argument('--out', default='//render.png')
ap.add_argument('--w', type=int, default=3200)
ap.add_argument('--h', type=int, default=1800)
ap.add_argument('--samples', type=int, default=192)
ap.add_argument('--tex', default='')  # Leitstand-Bildschirminhalt (PNG) für das Motiv „betrieb“
A = ap.parse_args(argv)
R = random.Random(7)

# ------------------------------------------------------------ Grundlagen
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'; p.get_devices()
    for d in p.devices: d.use = d.type == 'OPTIX'
    sc.cycles.samples = A.samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPTIX'
    sc.cycles.max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y = A.w, A.h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = -0.2
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_depth = '16'
    sc.render.filepath = A.out
    return sc

def mat(name, color, rough=0.5, metal=0.0, bump=None, bump_scale=8.0, bump_strength=0.15, emit=None, emit_strength=0.0, alpha=None, trans=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if trans: b.inputs['Transmission Weight'].default_value = trans
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = emit_strength
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        if bump == 'noise':
            t = nt.nodes.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = bump_scale; t.inputs['Detail'].default_value = 8
        elif bump == 'corrugate':
            t = nt.nodes.new('ShaderNodeTexWave'); t.wave_type = 'BANDS'; t.bands_direction = 'X'; t.inputs['Scale'].default_value = bump_scale
        nt.links.new(tc.outputs['Object'], t.inputs['Vector'])
        bn = nt.nodes.new('ShaderNodeBump'); bn.inputs['Strength'].default_value = bump_strength
        nt.links.new(t.outputs[0 if bump == 'noise' else 'Fac'], bn.inputs['Height'])
        nt.links.new(bn.outputs['Normal'], b.inputs['Normal'])
    return m

def varied(name, c1, c2, scale=0.05, rough=0.9, bump_scale=40, bump_strength=0.25, stripes=None):
    """Boden/Feld: Farbe aus großen Flecken, mittlerer Struktur und feiner Körnung; optional Fahrgassen."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); b.inputs['Roughness'].default_value = rough
    tc = nt.nodes.new('ShaderNodeTexCoord')
    def noise(sc, det=6):
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = sc; n.inputs['Detail'].default_value = det
        nt.links.new(tc.outputs['Object'], n.inputs['Vector']); return n.outputs['Fac']
    def op(kind, a, bb=None, c=None):
        mm = nt.nodes.new('ShaderNodeMath'); mm.operation = kind
        for i, v in enumerate((a, bb, c)):
            if v is None: continue
            if isinstance(v, (int, float)): mm.inputs[i].default_value = v
            else: nt.links.new(v, mm.inputs[i])
        return mm.outputs[0]
    big = noise(scale * 0.25, 4); mid = noise(scale * 2.5, 8); fine = noise(scale * 60, 4)
    f = op('MULTIPLY_ADD', big, 0.65, op('MULTIPLY', mid, 0.35))
    f = op('SUBTRACT', op('ADD', f, op('MULTIPLY', fine, 0.25)), 0.12)
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[0].color = (*c1, 1); ramp.color_ramp.elements[1].color = (*c2, 1)
    nt.links.new(f, ramp.inputs['Fac'])
    col = ramp.outputs['Color']
    if stripes:
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = stripes
        w.inputs['Scale'].default_value = 0.0105; w.inputs['Distortion'].default_value = 0.0
        nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
        fac = op('MULTIPLY', op('GREATER_THAN', w.outputs['Fac'], 0.993), 0.45)
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        nt.links.new(fac, mix.inputs['Factor'])
        mix.inputs['B'].default_value = (c1[0] * 0.9 + 0.05, c1[1] * 0.8 + 0.03, c1[2] * 0.6 + 0.02, 1)
        nt.links.new(col, mix.inputs['A']); col = mix.outputs['Result']
    nt.links.new(col, b.inputs['Base Color'])
    n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = bump_scale; n2.inputs['Detail'].default_value = 10
    nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
    bn = nt.nodes.new('ShaderNodeBump'); bn.inputs['Strength'].default_value = bump_strength
    nt.links.new(n2.outputs['Fac'], bn.inputs['Height']); nt.links.new(bn.outputs['Normal'], b.inputs['Normal'])
    return m

def leaf_mat():
    """Laubkrone: feine Farbvariation, starke Mikrostruktur, etwas Durchscheinen."""
    m = bpy.data.materials.new('Laub'); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); tc = nt.nodes.new('ShaderNodeTexCoord')
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 9.0
    nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
    no = nt.nodes.new('ShaderNodeTexNoise'); no.inputs['Scale'].default_value = 1.2; no.inputs['Detail'].default_value = 4
    nt.links.new(tc.outputs['Generated'], no.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements
    e[0].color = (0.010, 0.022, 0.006, 1); e[1].color = (0.05, 0.085, 0.02, 1); e[1].position = 0.8
    mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'
    nt.links.new(vo.outputs['Distance'], mm.inputs[0]); nt.links.new(no.outputs['Fac'], mm.inputs[1])
    ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'MULTIPLY_ADD'; ad.inputs[1].default_value = 1.6; ad.inputs[2].default_value = 0.05
    nt.links.new(mm.outputs[0], ad.inputs[0]); nt.links.new(ad.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.7; b.inputs['Subsurface Weight'].default_value = 0.15
    b.inputs['Subsurface Radius'].default_value = (0.2, 0.4, 0.1)
    bn = nt.nodes.new('ShaderNodeBump'); bn.inputs['Strength'].default_value = 1.0; bn.inputs['Distance'].default_value = 0.3
    nt.links.new(vo.outputs['Distance'], bn.inputs['Height']); nt.links.new(bn.outputs['Normal'], b.inputs['Normal'])
    return m

def fence_mat():
    m = bpy.data.materials.new('Zaungitter'); m.use_nodes = True; nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.32, 0.36, 0.34, 1); b.inputs['Metallic'].default_value = 0.6; b.inputs['Roughness'].default_value = 0.5
    tc = nt.nodes.new('ShaderNodeTexCoord'); br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = 1.0; br.inputs['Mortar Size'].default_value = 0.012; br.offset = 0
    br.inputs['Color1'].default_value = (0, 0, 0, 1); br.inputs['Color2'].default_value = (0, 0, 0, 1); br.inputs['Mortar'].default_value = (1, 1, 1, 1)
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (18, 18, 18)
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(br.outputs['Color'], mx.inputs['Fac']); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])
    return m

ASSETS = 'C:/dev/bess-assets'
IMGS = {}
def img(path, color=True):
    if path not in IMGS:
        im = bpy.data.images.load(path); im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'; IMGS[path] = im
    return IMGS[path]

def pbr(name, tid, size=2.0, tint=None, sat=1.0, val=1.0, rough=None, nrm=1.0, metal=0.0, var=0.0, var_scale=0.01, stripes=None, color_from_tex=True, base=None):
    """Material aus Poly-Haven-Texturen (Diffuse/Normal/Rough), Box-Projektion in Objektkoordinaten (Meter).
    size: reale Kantenlänge der Textur in m; tint/sat/val färben ein; var: großflächige Helligkeitsvariation gegen Kachelwiederholung."""
    d = f'{ASSETS}/textures/{tid}/{tid}_'
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / size,) * 3
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    def tex(suffix, color):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img(d + suffix + '_2k.jpg', color); t.projection = 'BOX'; t.projection_blend = 0.25
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector']); return t
    col = None
    if color_from_tex:
        dt = tex('diff', True); hs = nt.nodes.new('ShaderNodeHueSaturation')
        hs.inputs['Saturation'].default_value = sat; hs.inputs['Value'].default_value = val
        nt.links.new(dt.outputs['Color'], hs.inputs['Color']); col = hs.outputs['Color']
        if tint:
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
            nt.links.new(col, mx.inputs['A']); mx.inputs['B'].default_value = (*tint, 1); col = mx.outputs['Result']
    else:
        dt = tex('diff', True); bw = nt.nodes.new('ShaderNodeRGBToBW'); nt.links.new(dt.outputs['Color'], bw.inputs['Color'])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.82; mr.inputs['To Max'].default_value = 1.08
        nt.links.new(bw.outputs[0], mr.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        mx.inputs['A'].default_value = (*base, 1); cv = nt.nodes.new('ShaderNodeCombineColor')
        for i in range(3): nt.links.new(mr.outputs[0], cv.inputs[i])
        nt.links.new(cv.outputs[0], mx.inputs['B']); col = mx.outputs['Result']
    if var:
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = var_scale; n.inputs['Detail'].default_value = 3
        nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 1 - var; mr.inputs['To Max'].default_value = 1 + var
        nt.links.new(n.outputs['Fac'], mr.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        cv = nt.nodes.new('ShaderNodeCombineColor')
        for i in range(3): nt.links.new(mr.outputs[0], cv.inputs[i])
        nt.links.new(col, mx.inputs['A']); nt.links.new(cv.outputs[0], mx.inputs['B']); col = mx.outputs['Result']
    if stripes:
        w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = stripes
        w.inputs['Scale'].default_value = 0.0105; nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
        gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.993
        nt.links.new(w.outputs['Fac'], gt.inputs[0])
        ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'; ml.inputs[1].default_value = 0.35; nt.links.new(gt.outputs[0], ml.inputs[0])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(ml.outputs[0], mx.inputs['Factor'])
        nt.links.new(col, mx.inputs['A']); mx.inputs['B'].default_value = (0.09, 0.075, 0.05, 1); col = mx.outputs['Result']
    nt.links.new(col, b.inputs['Base Color'])
    if rough is None:
        import os
        rp = d + 'rough_2k.jpg'
        if os.path.exists(rp):
            rt = tex('rough', False); nt.links.new(rt.outputs['Color'], b.inputs['Roughness'])
        else: b.inputs['Roughness'].default_value = 0.8
    else: b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    nm = tex('nor_gl', False); nn = nt.nodes.new('ShaderNodeNormalMap'); nn.inputs['Strength'].default_value = nrm
    nt.links.new(nm.outputs['Color'], nn.inputs['Color']); nt.links.new(nn.outputs['Normal'], b.inputs['Normal'])
    return m

def age(m, height=0.9, dirt=(0.30, 0.27, 0.22), amount=0.55, streaks=0.18):
    """Gebrauchsspuren: Spritzschmutz zum Boden hin (Objekt-Z), Laufspuren von oben, fleckiger Staub."""
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    src = b.inputs['Base Color'].links[0].from_socket if b.inputs['Base Color'].links else None
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = height; mr.inputs['From Max'].default_value = 0.3
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 3.0; n.inputs['Detail'].default_value = 8
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'; nt.links.new(mr.outputs[0], ml.inputs[0]); nt.links.new(n.outputs['Fac'], ml.inputs[1])
    # Laufspuren: in X gestreckte Rauschstreifen
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 14, 0.6); nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 2.0; n2.inputs['Detail'].default_value = 4; nt.links.new(mp.outputs['Vector'], n2.inputs['Vector'])
    st = nt.nodes.new('ShaderNodeMapRange'); st.inputs['From Min'].default_value = 0.55; st.inputs['From Max'].default_value = 0.8; st.inputs['To Max'].default_value = streaks
    nt.links.new(n2.outputs['Fac'], st.inputs['Value'])
    ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'; ad.use_clamp = True; nt.links.new(ml.outputs[0], ad.inputs[0]); nt.links.new(st.outputs[0], ad.inputs[1])
    fac = nt.nodes.new('ShaderNodeMath'); fac.operation = 'MULTIPLY'; fac.inputs[1].default_value = amount; nt.links.new(ad.outputs[0], fac.inputs[0])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(fac.outputs[0], mx.inputs['Factor'])
    if src: nt.links.new(src, mx.inputs['A'])
    else: mx.inputs['A'].default_value = b.inputs['Base Color'].default_value
    mx.inputs['B'].default_value = (*dirt, 1); nt.links.new(mx.outputs['Result'], b.inputs['Base Color'])
    return m

M = {}
def materials():
    M['container'] = mat('Containerblech', (0.40, 0.42, 0.41), 0.38, 0.0, bump='corrugate', bump_scale=3.4, bump_strength=0.9)
    M['door'] = mat('Tür', (0.36, 0.38, 0.37), 0.35, 0.0)
    M['dark'] = mat('Lüfter', (0.05, 0.055, 0.06), 0.6)
    M['hvac'] = mat('Klimagerät', (0.46, 0.47, 0.46), 0.45, 0.0, bump='noise', bump_scale=200, bump_strength=0.05)
    M['steel'] = mat('Stahl verzinkt', (0.52, 0.53, 0.54), 0.55, 1.0, bump='noise', bump_scale=30, bump_strength=0.08)
    M['concrete'] = mat('Beton', (0.30, 0.30, 0.28), 0.85, bump='noise', bump_scale=12, bump_strength=0.2)
    M['gravel'] = varied('Schotter', (0.15, 0.145, 0.13), (0.24, 0.23, 0.21), scale=0.6, bump_scale=160, bump_strength=0.7)
    M['asphalt'] = varied('Asphalt', (0.12, 0.12, 0.12), (0.2, 0.2, 0.19), scale=0.6, rough=0.8, bump_scale=200, bump_strength=0.2)
    M['track'] = varied('Wirtschaftsweg', (0.42, 0.39, 0.33), (0.55, 0.52, 0.45), scale=0.5, bump_scale=60, bump_strength=0.4)
    M['tx'] = mat('Transformator', (0.17, 0.21, 0.20), 0.45, 0.1)
    M['insul'] = mat('Isolator', (0.45, 0.25, 0.14), 0.25)
    M['grass'] = varied('Grünland', (0.07, 0.15, 0.035), (0.13, 0.22, 0.05), scale=0.03)
    M['crop'] = varied('Wintergetreide', (0.10, 0.19, 0.035), (0.17, 0.26, 0.06), scale=0.02, stripes='X')
    M['plough'] = varied('Acker', (0.20, 0.13, 0.08), (0.28, 0.19, 0.12), scale=0.05, stripes='Y', bump_strength=0.5)
    M['stubble'] = varied('Stoppel', (0.36, 0.30, 0.16), (0.44, 0.37, 0.21), scale=0.03, stripes='X')
    M['rape'] = varied('Raps', (0.10, 0.22, 0.05), (0.15, 0.27, 0.06), scale=0.04)
    M['leaf'] = leaf_mat()
    M['earth'] = varied('Wall', (0.20, 0.16, 0.10), (0.16, 0.22, 0.07), scale=0.3)
    M['fence'] = fence_mat()
    M['white'] = mat('Turm', (0.62, 0.63, 0.63), 0.4)
    M['brick'] = mat('Klinker', (0.42, 0.15, 0.09), 0.8, bump='noise', bump_scale=40, bump_strength=0.15)
    M['roof'] = mat('Dachziegel', (0.30, 0.10, 0.06), 0.6, bump='corrugate', bump_scale=30, bump_strength=0.3)
    M['roof2'] = mat('Dach anthrazit', (0.08, 0.08, 0.09), 0.5, bump='corrugate', bump_scale=30, bump_strength=0.3)
    M['glass'] = mat('Glas', (0.08, 0.1, 0.12), 0.05, 0.0)
    M['beacon'] = mat('Signal', (0.9, 0.3, 0.05), 0.4, emit=(1.0, 0.35, 0.05), emit_strength=0.0)
    M['tray'] = mat('Kabelpritsche', (0.45, 0.46, 0.47), 0.5, 1.0)
    M['signyellow'] = mat('Warnschild', (0.75, 0.50, 0.02), 0.5)
    M['water'] = mat('Wasser', (0.01, 0.014, 0.012), 0.08)
    M['swale'] = mat('Muldengras', (0.035, 0.07, 0.015), 0.85, bump='noise', bump_scale=30, bump_strength=0.4)
    # Bildwelt 2.0: fotografische Oberflächen (Poly Haven, CC0)
    M['container'] = pbr('Containerblech', 'container_side', size=1.94, color_from_tex=False, base=(0.46, 0.48, 0.48), rough=0.45, nrm=0.6)
    M['door'] = pbr('Tür', 'container_side', size=1.94, color_from_tex=False, base=(0.30, 0.32, 0.32), rough=0.4, nrm=0.4)
    M['hvac'] = pbr('Klimagerät', 'corrugated_iron_02', size=0.8, color_from_tex=False, base=(0.40, 0.41, 0.41), rough=0.45, nrm=0.25)
    M['gravel'] = pbr('Schotter', 'gravel_floor_02', size=2.0, sat=0.6, val=0.36, var=0.12, var_scale=0.05)
    M['track'] = pbr('Wirtschaftsweg', 'rocky_gravel', size=1.8, sat=0.55, val=0.8, var=0.15, var_scale=0.05)
    M['asphalt'] = pbr('Asphalt', 'clean_asphalt', size=2.1, val=0.85, var=0.1, var_scale=0.04)
    M['concrete'] = pbr('Beton', 'concrete_floor_02', size=2.0, sat=0.4, val=0.75)
    M['brick'] = pbr('Klinker', 'red_brick_03', size=1.2, val=0.9)
    M['roof'] = pbr('Dachziegel', 'roof_tiles', size=1.6, sat=0.8, val=0.7, tint=(0.85, 0.55, 0.45))
    M['grass'] = pbr('Grünland', 'aerial_grass_rock', size=37.0, sat=1.1, val=0.62, tint=(0.62, 0.95, 0.42), var=0.18, var_scale=0.004)
    M['crop'] = pbr('Wintergetreide', 'aerial_grass_rock', size=37.0, sat=1.25, val=0.6, tint=(0.52, 1.0, 0.36), var=0.15, var_scale=0.006, stripes='X')
    M['rape'] = pbr('Raps', 'aerial_grass_rock', size=31.0, sat=1.3, val=0.55, tint=(0.45, 0.95, 0.30), var=0.15, var_scale=0.005)
    M['plough'] = pbr('Acker', 'dirt_aerial_02', size=43.0, sat=0.8, val=0.42, var=0.15, var_scale=0.006, stripes='Y')
    M['stubble'] = pbr('Stoppel', 'dirt_aerial_02', size=43.0, sat=0.65, val=0.75, tint=(1.0, 0.92, 0.62), var=0.12, var_scale=0.006, stripes='X')
    age(M['container'], height=1.1, amount=0.5); age(M['hvac'], height=1.4, amount=0.4); age(M['door'], height=1.0, amount=0.45)
    M['porcelain'] = mat('Porzellan', (0.20, 0.07, 0.04), 0.12)
    M['composite'] = mat('Verbundisolator', (0.42, 0.43, 0.44), 0.35)
    M['alu'] = mat('Aluminium', (0.70, 0.71, 0.72), 0.3, 1.0)
    M['firewall'] = pbr('Brandschutzwand', 'concrete_floor_02', size=2.5, sat=0.3, val=0.85)
    M['earthcable'] = mat('Erdungsleiter', (0.35, 0.40, 0.05), 0.5)
    M['label'] = mat('Typschild', (0.75, 0.76, 0.74), 0.4)
    M['earth'] = pbr('Wall', 'aerial_grass_rock', size=6.0, sat=0.9, val=0.45, tint=(0.7, 0.85, 0.5))
    M['tank'] = mat('Löschwasserbehälter', (0.12, 0.17, 0.14), 0.5)
    M['rubber'] = mat('Dichtung', (0.02, 0.02, 0.02), 0.6)

def box(name, size, loc, m, rot_z=0.0, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler.z = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        bv = o.modifiers.new('bv', 'BEVEL'); bv.width = bevel; bv.segments = 2
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = False
    return o

def cyl(name, r, depth, loc, m, rot=(0, 0, 0), verts=24, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object; o.name = name; o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o

def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); o = bpy.context.object; o.name = name
    return o

def plane(name, sx, sy, loc, m, rot_z=0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = (sx, sy, 1); o.rotation_euler.z = rot_z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); o.data.materials.append(m)
    return o

# ------------------------------------------------------------ Bauteile
PROTO = {}
def proto_container():
    """Batteriecontainer ca. 6,1 × 2,45 × 2,9 m: Trapezblech, vier Wartungstüren, Klimagerät an der Stirnseite,
    Lüftungsgitter, Signalleuchte, Fundamentbalken. Herstellerneutral."""
    L, W, H = 6.06, 2.44, 2.9
    parts = [box('c_body', (L, W, H), (0, 0, H / 2 + 0.35), M['container'], bevel=0.03)]
    for i in range(4):  # Wartungstüren Längsseite (−Y)
        x = -L / 2 + 0.55 + i * 1.32
        parts.append(box('c_door', (1.18, 0.03, 2.35), (x + 0.59, -W / 2 - 0.012, 1.6), M['door'], bevel=0.01))
        parts.append(box('c_handle', (0.04, 0.05, 0.35), (x + 1.05, -W / 2 - 0.04, 1.55), M['steel']))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (0.42, H + 0.28):
                parts.append(box('c_corner', (0.18, 0.18, 0.14), (sx * (L / 2 - 0.09), sy * (W / 2 - 0.09), z), M['door']))
    parts.append(box('c_roofedge', (L + 0.02, W + 0.04, 0.08), (0, 0, H + 0.33), M['door']))
    for i in range(4):
        x = -L / 2 + 0.55 + i * 1.32
        for z in (0.9, 2.3):
            parts.append(box('c_hinge', (0.05, 0.05, 0.12), (x + 0.05, -W / 2 - 0.04, z), M['steel']))
    for k in range(5):
        parts.append(cyl('c_gland', 0.05, 0.12, (-L / 2 + 1.0 + k * 0.25, W / 2 + 0.05, 0.6), M['rubber'], rot=(math.pi / 2, 0, 0), verts=12))
    for i in range(4):
        x = -L / 2 + 0.55 + i * 1.32
        for dz in (0.42, 2.78):
            parts.append(box('c_seal', (1.2, 0.02, 0.025), (x + 0.59, -W / 2 - 0.03, dz), M['rubber']))
        for dx in (-0.01, 1.19):
            parts.append(box('c_seal', (0.025, 0.02, 2.36), (x + dx, -W / 2 - 0.03, 1.6), M['rubber']))
    parts.append(box('c_plate', (0.32, 0.01, 0.2), (L / 2 - 0.5, -W / 2 - 0.035, 2.4), M['label']))
    parts.append(cyl('c_earth', 0.012, 0.5, (-L / 2 + 0.25, -W / 2 - 0.08, 0.2), M['earthcable'], verts=8))
    parts.append(box('c_hvac', (0.42, 1.9, 2.1), (L / 2 + 0.21, 0, 1.55), M['hvac'], bevel=0.02))
    for z in (1.05, 1.95):
        for rr_ in (0.34, 0.24, 0.14):
            bpy.ops.mesh.primitive_torus_add(major_radius=rr_, minor_radius=0.008, location=(L / 2 + 0.445, 0, z), rotation=(0, math.pi / 2, 0))
            t = bpy.context.object; t.data.materials.append(M['steel']); parts.append(t)
    for k in range(9):
        parts.append(box('c_slat', (0.03, 1.7, 0.035), (L / 2 + 0.43, 0, 0.55 + k * 0.05), M['dark']))
    for z in (1.05, 1.95):
        parts.append(cyl('c_fan', 0.32, 0.03, (L / 2 + 0.43, 0, z), M['dark'], rot=(0, math.pi / 2, 0)))
    parts.append(box('c_louvre', (0.7, 0.03, 0.4), (-L / 2 + 0.6, W / 2 + 0.012, 2.8), M['dark']))
    parts.append(box('c_louvre2', (0.7, 0.03, 0.4), (L / 2 - 0.9, W / 2 + 0.012, 2.8), M['dark']))
    parts.append(cyl('c_beacon', 0.07, 0.16, (-L / 2 + 0.3, -W / 2 + 0.3, H + 0.43), M['beacon']))
    parts.append(box('c_sign', (0.3, 0.01, 0.3), (-L / 2 + 0.35, -W / 2 - 0.02, 2.2), M['signyellow']))
    for x in (-L / 2 + 0.3, L / 2 - 0.3):
        parts.append(box('c_found', (0.5, W + 0.2, 0.4), (x, 0, 0.2), M['concrete']))
    o = join(parts, 'Batteriecontainer'); return o

def proto_pcs():
    """Leistungselektronik-Station: Wechselrichterschrank + Mittelspannungstransformator mit Kühlrippen + Schaltfeld."""
    parts = [box('p_base', (6.2, 2.6, 0.3), (0, 0, 0.15), M['concrete'])]
    parts.append(box('p_inv', (2.4, 2.2, 2.4), (-1.8, 0, 1.5), M['hvac'], bevel=0.02))
    for i in range(3):
        parts.append(box('p_vent', (0.6, 0.02, 0.9), (-2.6 + i * 0.8, -1.11, 1.6), M['dark']))
    parts.append(box('p_tx', (1.6, 1.4, 1.7), (0.6, 0, 1.15), M['tx'], bevel=0.02))
    for i in range(7):
        parts.append(box('p_fin', (1.5, 0.04, 1.3), (0.6, -0.72 - i * 0.07, 1.05), M['tx']))
        parts.append(box('p_fin', (1.5, 0.04, 1.3), (0.6, 0.72 + i * 0.07, 1.05), M['tx']))
    for x in (0.2, 0.6, 1.0):
        parts.append(cyl('p_bush', 0.06, 0.4, (x, 0, 2.2), M['insul']))
    parts.append(box('p_sw', (1.2, 2.0, 2.3), (2.4, 0, 1.45), M['hvac'], bevel=0.02))
    return join(parts, 'PCS-Station')

def inst(proto, loc, rot_z=0.0, name=None):
    o = bpy.data.objects.new(name or proto.name + '_i', proto.data)
    o.location = loc; o.rotation_euler.z = rot_z
    bpy.context.collection.objects.link(o); return o

LEAF_DENSITY = 70.0
USE_TREE_MODEL = True
VEG = {'crown': [], 'trunk': []}  # Punkte (Position, Skalierung) für Instanzierung per Geometry Nodes

def leaf_card():
    """Blattbüschel-Karte mit elliptischer Alpha-Maske (prozedural)."""
    if 'leafcard' in PROTO: return PROTO['leafcard']
    bpy.ops.mesh.primitive_plane_add(size=0.32, location=(0, 0, -800))
    o = bpy.context.object; o.name = 'Blattkarte'
    m = bpy.data.materials.new('Blatt'); m.use_nodes = True; nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord'); oi = nt.nodes.new('ShaderNodeObjectInfo')
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 3.5; vo.feature = 'F1'
    nt.links.new(tc.outputs['UV'], vo.inputs['Vector'])
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'LESS_THAN'; gt.inputs[1].default_value = 0.33
    nt.links.new(vo.outputs['Distance'], gt.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); e = ramp.color_ramp.elements
    e[0].color = (0.02, 0.05, 0.012, 1); e[1].color = (0.10, 0.17, 0.035, 1)
    nt.links.new(oi.outputs['Random'], ramp.inputs['Fac'])
    hs = nt.nodes.new('ShaderNodeHueSaturation'); hs.inputs['Value'].default_value = 1.0
    nt.links.new(ramp.outputs['Color'], hs.inputs['Color']); nt.links.new(vo.outputs['Distance'], hs.inputs['Fac'])
    nt.links.new(hs.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.55; b.inputs['Subsurface Weight'].default_value = 0.0
    b.inputs['Transmission Weight'].default_value = 0.0
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    tl.inputs['Color'].default_value = (0.12, 0.22, 0.03, 1)
    ms = nt.nodes.new('ShaderNodeMixShader'); ms.inputs['Fac'].default_value = 0.25
    nt.links.new(b.outputs[0], ms.inputs[1]); nt.links.new(tl.outputs[0], ms.inputs[2])
    mx = nt.nodes.new('ShaderNodeMixShader'); nt.links.new(gt.outputs[0], mx.inputs['Fac'])
    nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(ms.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])
    m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
    o.data.materials.append(m); PROTO['leafcard'] = o
    return o

def foliate(c, density=90.0):
    """Verteilt Blattkarten auf der Kronenhülle; die Hülle bleibt als dunkler Kern erhalten."""
    card = leaf_card()
    ng = bpy.data.node_groups.new('Belaubung', 'GeometryNodeTree')
    ng.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes; Lk = ng.links
    gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
    dp = N.new('GeometryNodeDistributePointsOnFaces'); dp.inputs['Density'].default_value = density
    oi = N.new('GeometryNodeObjectInfo'); oi.inputs['Object'].default_value = card
    io = N.new('GeometryNodeInstanceOnPoints')
    rv = N.new('FunctionNodeRandomValue'); rv.data_type = 'FLOAT_VECTOR'
    rv.inputs[0].default_value = (0, 0, 0); rv.inputs[1].default_value = (6.283, 6.283, 6.283)
    rs = N.new('FunctionNodeRandomValue'); rs.data_type = 'FLOAT'
    rs.inputs[2].default_value = 0.7; rs.inputs[3].default_value = 1.4
    sp = N.new('GeometryNodeSetPosition'); off = N.new('ShaderNodeVectorMath'); off.operation = 'SCALE'
    nrm = N.new('GeometryNodeInputNormal'); rn = N.new('FunctionNodeRandomValue'); rn.data_type = 'FLOAT'
    rn.inputs[2].default_value = -0.12; rn.inputs[3].default_value = 0.08
    jg = N.new('GeometryNodeJoinGeometry')
    Lk.new(gi.outputs[0], dp.inputs['Mesh'])
    Lk.new(nrm.outputs[0], off.inputs[0]); Lk.new(rn.outputs[1], off.inputs['Scale'])
    Lk.new(dp.outputs['Points'], sp.inputs['Geometry']); Lk.new(off.outputs['Vector'], sp.inputs['Offset'])
    Lk.new(sp.outputs[0], io.inputs['Points']); Lk.new(oi.outputs['Geometry'], io.inputs['Instance'])
    Lk.new(rv.outputs[0], io.inputs['Rotation']); Lk.new(rs.outputs[1], io.inputs['Scale'])
    Lk.new(gi.outputs[0], jg.inputs[0]); Lk.new(io.outputs[0], jg.inputs[0])
    Lk.new(jg.outputs[0], go.inputs[0])
    c.modifiers.new('laub', 'NODES').node_group = ng

def crowns_proto():
    if 'crown' in PROTO: return
    col = bpy.data.collections.new('Kronen'); bpy.context.scene.collection.children.link(col)
    tcol = bpy.data.collections.new('Stämme'); bpy.context.scene.collection.children.link(tcol)
    for k in range(5):
        rr = random.Random(500 + k); parts = []
        for j in range(rr.randint(5, 8)):
            off = (rr.uniform(-0.55, 0.55), rr.uniform(-0.55, 0.55), rr.uniform(-0.35, 0.45))
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=rr.uniform(0.45, 0.7), location=off)
            parts.append(bpy.context.object)
        c = join(parts, 'Krone%d' % k)
        rm = c.modifiers.new('r', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.06
        tex = bpy.data.textures.new('cr%d' % k, 'VORONOI'); tex.noise_scale = 0.16
        dm = c.modifiers.new('d', 'DISPLACE'); dm.texture = tex; dm.strength = 0.22
        tex2 = bpy.data.textures.new('crn%d' % k, 'CLOUDS'); tex2.noise_scale = 0.3
        dm2 = c.modifiers.new('d2', 'DISPLACE'); dm2.texture = tex2; dm2.strength = 0.25
        for mname in ('r', 'd', 'd2'): bpy.ops.object.modifier_apply(modifier=mname)
        dec = c.modifiers.new('x', 'DECIMATE'); dec.ratio = 0.35; bpy.ops.object.modifier_apply(modifier='x')
        c.data.materials.clear(); c.data.materials.append(M['leaf']); bpy.ops.object.shade_smooth(); c.location = (0, 0, -500 - k * 10)
        foliate(c, density=LEAF_DENSITY)
        for uc in c.users_collection: uc.objects.unlink(c)
        col.objects.link(c)
    t = cyl('stamm', 0.22, 1, (0, 0, 0.5), M['earth'], verts=8)
    bpy.ops.object.transform_apply(location=True)
    for uc in t.users_collection: uc.objects.unlink(t)
    tcol.objects.link(t); t.location = (0, 0, -700)
    PROTO['crown'] = col; PROTO['trunk'] = tcol

def scatter(name, pts, coll, whole=None):
    """Instanzen einer Sammlung auf Punkten; Skalierung je Punkt aus Attribut 'sc', Drehung zufällig."""
    if not pts: return
    me = bpy.data.meshes.new(name); me.from_pydata([p for p, _ in pts], [], [])
    at = me.attributes.new('sc', 'FLOAT_VECTOR', 'POINT')
    at.data.foreach_set('vector', [c for _, s in pts for c in s])
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    ng.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes; L = ng.links
    gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
    mp = N.new('GeometryNodeMeshToPoints'); io = N.new('GeometryNodeInstanceOnPoints')
    ci = N.new('GeometryNodeCollectionInfo'); ci.inputs['Collection'].default_value = coll
    if whole is None: whole = coll.name in ('Baummodell', 'Grasmodell')
    ci.inputs['Separate Children'].default_value = not whole; ci.inputs['Reset Children'].default_value = not whole
    rv = N.new('FunctionNodeRandomValue'); rv.data_type = 'FLOAT_VECTOR'
    rv.inputs[0].default_value = (0, 0, 0); rv.inputs[1].default_value = (0, 0, 6.283)
    na = N.new('GeometryNodeInputNamedAttribute'); na.data_type = 'FLOAT_VECTOR'; na.inputs['Name'].default_value = 'sc'
    L.new(gi.outputs[0], mp.inputs['Mesh']); L.new(mp.outputs['Points'], io.inputs['Points'])
    L.new(ci.outputs[0], io.inputs['Instance']); io.inputs['Pick Instance'].default_value = not whole
    L.new(rv.outputs[0], io.inputs['Rotation']); L.new(na.outputs[0], io.inputs['Scale'])
    L.new(io.outputs[0], go.inputs[0])
    o.modifiers.new('gn', 'NODES').node_group = ng
    return o

def tree_proto():
    if 'treemodel' in PROTO: return PROTO['treemodel']
    col = bpy.data.collections.new('Baummodell'); bpy.context.scene.collection.children.link(col)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ASSETS}/models/tree_small_02/tree_small_02_2k.gltf')
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for uc in list(o.users_collection): uc.objects.unlink(o)
        col.objects.link(o)
    # Höhe normieren auf 1 m (Skalierung erfolgt je Instanz)
    zs = [ (o.matrix_world @ Vector(c)).z for o in new if o.type == 'MESH' for c in o.bound_box ]
    h = max(zs) - min(zs) if zs else 1.0
    root = bpy.data.objects.new('Baum_Wurzel', None); col.objects.link(root)
    for o in new:
        if o.parent is None: o.parent = root
    root.scale = (1 / h,) * 3; root.location = (0, 0, -min(zs) / h if zs else 0)
    PROTO['treemodel'] = col; PROTO['treeh'] = h
    return col

def flush_veg():
    if 'crown' not in PROTO: return
    scatter('Gehölz', VEG['crown'], PROTO['crown']); scatter('Stämme', VEG['trunk'], PROTO['trunk'])
    if VEG.get('model'): scatter('Bäume', VEG['model'], tree_proto())

def hedge(p0, p1, wall=True, density=0.33, h=(6, 12), seed=1, young=False):
    """Knick: Erdwall mit dichtem Strauchgürtel und einzelnen Überhältern."""
    crowns_proto()
    rr = random.Random(seed)
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length; ang = math.atan2(d.y, d.x)
    if wall and L > 1:
        bpy.ops.mesh.primitive_cube_add(size=1, location=((p0 + p1) / 2).to_3d())
        w = bpy.context.object; w.scale = (L, 3.2, 1.6); w.rotation_euler.z = ang; w.location.z = 0.2
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bv = w.modifiers.new('b', 'BEVEL'); bv.width = 1.0; bv.segments = 3
        w.data.materials.append(M['earth'])
    n = int(L * density)
    nrm = Vector((-d.y, d.x)).normalized() if L else Vector((0, 1))
    base = 1.2 if wall else 0.0
    for i in range(n):  # Strauchgürtel (Hasel, Weißdorn, Schlehe)
        t = (i + rr.random() * 0.8) / max(n, 1)
        p = p0 + d * t + nrm * rr.uniform(-1.4, 1.4)
        r = rr.uniform(1.8, 3.4); hh = rr.uniform(3.0, 6.5)
        if young: r *= 0.35; hh *= 0.28
        VEG['crown'].append(((p.x, p.y, base + hh - r * 0.7), (r * rr.uniform(1.0, 1.5), r * rr.uniform(1.0, 1.5), r * rr.uniform(0.8, 1.1))))
    k = 0.0
    while k < L and not young:  # Überhälter (Eiche, Esche)
        k += rr.uniform(18, 45)
        if k >= L: break
        p = p0 + d * (k / L) + nrm * rr.uniform(-1, 1)
        tree((p.x, p.y), rr.uniform(*h) * 1.2, rr.random(), base)

def tree(p, hh, seed, base=0.0):
    crowns_proto()
    rr = random.Random(seed); r = hh * rr.uniform(0.3, 0.4)
    if USE_TREE_MODEL:
        VEG.setdefault('model', []).append(((p[0], p[1], base - 0.2), (hh * rr.uniform(0.9, 1.15), hh * rr.uniform(0.9, 1.15), hh)))
        return
    VEG['crown'].append(((p[0], p[1], base + hh - r * 0.9), (r * rr.uniform(0.9, 1.2), r * rr.uniform(0.9, 1.2), r * rr.uniform(0.8, 1.0))))
    VEG['trunk'].append(((p[0], p[1], base), (1.2, 1.2, max(hh - r, 0.5))))

def turbine(p, hub=135, rot=0.0, yaw=0.0):
    """Windenergieanlage (Hintergrund): Rohrturm, Gondel, Nabe, drei Rotorblätter."""
    x, y = p; parts = []
    parts.append(cyl('wt_tower', 3.0, hub, (x, y, hub / 2), M['white'], r2=1.6, verts=24))
    parts.append(box('wt_nac', (11, 4, 4), (x, y, hub + 1.5), M['white'], bevel=0.8))
    parts.append(cyl('wt_hub', 1.6, 3, (x - 6.5, y, hub + 1.5), M['white'], rot=(0, math.pi / 2, 0)))
    o = join(parts, 'WEA'); o.rotation_euler.z = yaw
    bl = []
    for i in range(3):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        b = bpy.context.object; b.scale = (0.5, 2.6, 62)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for v in b.data.vertices:
            if v.co.z > 0: v.co.y *= 0.3; v.co.x *= 0.5
        b.location.z = 31; bpy.ops.object.transform_apply(location=True)
        b.rotation_euler.x = rot + i * 2.0944; b.data.materials.append(M['white']); bl.append(b)
    rotor = join(bl, 'Rotor')
    rotor.location = Vector((x, y, hub + 1.5)) + Matrix.Rotation(yaw, 3, 'Z') @ Vector((-7.6, 0, 0))
    rotor.rotation_euler.z = yaw
    return o

def lattice_pylon(p, h=48, yaw=0.0):
    """Freileitungsmast (Stahlgitter) über Wireframe-Modifikator."""
    x, y = p
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
    m = bpy.context.object; m.scale = (6, 6, h); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in m.data.vertices:
        if v.co.z > 0: v.co.x *= 0.25; v.co.y *= 0.25
    m.modifiers.new('sub', 'SUBSURF').subdivision_type = 'SIMPLE'
    m.modifiers['sub'].levels = 3; m.modifiers['sub'].render_levels = 3
    wf = m.modifiers.new('wf', 'WIREFRAME'); wf.thickness = 0.12
    m.data.materials.append(M['steel']); m.rotation_euler.z = yaw
    arms = []
    for z, w in ((h * 0.72, 22), (h * 0.88, 16)):
        arms.append(box('arm', (w, 1.2, 1.0), (x, y, z), M['steel']))
    for a in arms:
        a.rotation_euler.z = yaw
        w2 = a.modifiers.new('wf', 'WIREFRAME'); w2.thickness = 0.1
    return m

def wire(points, r=0.025, m=None, sag=0.0):
    cu = bpy.data.curves.new('ltg', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 1
    sp = cu.splines.new('POLY')
    pts = []
    for i in range(len(points) - 1):
        a, b = Vector(points[i]), Vector(points[i + 1])
        for k in range(12):
            t = k / 12; q = a.lerp(b, t); q.z -= sag * 4 * t * (1 - t); pts.append(q)
    pts.append(Vector(points[-1]))
    sp.points.add(len(pts) - 1)
    for i, q in enumerate(pts): sp.points[i].co = (*q, 1)
    o = bpy.data.objects.new('Leitung', cu); bpy.context.collection.objects.link(o)
    o.data.materials.append(m or M['steel']); return o

def fence(x0, y0, x1, y1, h=2.4):
    objs = []
    for (a, b) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        a, b = Vector(a), Vector(b); d = b - a; L = d.length
        bpy.ops.mesh.primitive_plane_add(size=1, location=((a + b) / 2).to_3d() + Vector((0, 0, h / 2)))
        f = bpy.context.object; f.scale = (L, h, 1); f.rotation_euler = (math.pi / 2, 0, math.atan2(d.y, d.x))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        f.data.uv_layers[0].data[0].uv = (0, 0)
        for loop in f.data.loops: pass
        uv = f.data.uv_layers[0].data
        for i, lp in enumerate(f.data.loops):
            co = f.data.vertices[lp.vertex_index].co
            uv[i].uv = ((co.x + L / 2) / 2.4, (co.y + h / 2) / 2.4)
        f.data.materials.append(M['fence']); objs.append(f)
        n = int(L / 3)
        for i in range(n + 1):
            q = a + d * (i / max(n, 1))
            objs.append(cyl('pfosten', 0.04, h + 0.1, (q.x, q.y, (h + 0.1) / 2), M['steel'], verts=8))
    return objs

# ------------------------------------------------------------ Anlage
def bess_plant(cx=0.0, cy=0.0, rows=6, per_row=8, lit=False):
    """Beispielanlage in der Größenordnung eines mittelgroßen Netzspeichers (ca. 48 Batteriecontainer).
    Abstände zwischen Einheiten als Brandschutzabstand, Gassen für Wartung und Feuerwehr."""
    cont = PROTO.get('cont') or proto_container(); PROTO['cont'] = cont; cont.location = (0, 0, -900)
    pcs = PROTO.get('pcs') or proto_pcs(); PROTO['pcs'] = pcs; pcs.location = (0, 0, -900)
    pitch_x, pitch_y = 6.06 + 3.0, 2.44 + 9.0
    W = per_row * pitch_x + 16; Hh = rows * pitch_y + 30
    x0 = cx - W / 2; y0 = cy - Hh / 2
    plane('Schotterfläche', W, Hh, (cx, cy, 0.03), M['gravel'])
    for r in range(rows):
        y = y0 + 18 + r * pitch_y
        for c in range(per_row):
            x = x0 + 8 + pitch_x / 2 + c * pitch_x
            if c == per_row // 2:  # Mittelgang mit PCS-Station
                continue
            inst(cont, (x, y, 0))
        inst(pcs, (x0 + 8 + pitch_x / 2 + (per_row // 2) * pitch_x, y, 0))
        # Kabelpritsche entlang der Reihe
        for k in range(int((per_row * pitch_x - 4) / 1.0)):
            box('Kabelkanal', (0.96, 0.6, 0.06), (x0 + 10 + k * 1.0, y + 1.95, 0.05), M['concrete'])
    # Übergabe / Mittelspannungsschaltanlage und Betriebsgebäude
    box('Übergabestation', (8, 3, 3), (x0 + 12, y0 + 6, 1.5), M['hvac'], bevel=0.03)
    box('Betriebsgebäude', (6, 3, 3), (x0 + 24, y0 + 6, 1.5), M['container'], bevel=0.03)
    box('Löschwasser', (0.1, 0.1, 0.1), (x0 + 4, y0 + 4, 0), M['dark'])
    cyl('Löschwasserbehälter', 3.2, 4.5, (x0 + W - 8, y0 + Hh - 7, 2.25), M['tank'], verts=48)
    # Erschließung: befestigte Fahrwege (Feuerwehr, Wartung) entlang West- und Nordseite
    plane('Fahrweg West', 6, Hh + 3, (x0 + 3, cy + 1.5, 0.05), M['asphalt'])
    plane('Fahrweg Nord', W - 22, 6, (x0 + (W - 22) / 2, y0 + Hh - 7, 0.05), M['asphalt'])
    # Entwässerung: Versickerungsmulde entlang der Südseite, Regenrückhaltebecken an der Südostecke
    plane('Mulde', W + 10, 4, (cx, y0 - 9, 0.02), M['swale'])
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1, fill_type='NGON', location=(x0 + W - 10, y0 - 17, 0.015))
    bk = bpy.context.object; bk.name = 'Böschung'; bk.scale = (10.5, 5.8, 1); bk.data.materials.append(M['swale'])
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1, fill_type='NGON', location=(x0 + W - 10, y0 - 17, 0.03))
    rb = bpy.context.object; rb.name = 'Rückhaltebecken'; rb.scale = (8.0, 3.8, 1); rb.data.materials.append(M['water'])
    fence(x0 - 3, y0 - 3, x0 + W + 3, y0 + Hh + 3)
    return (x0, y0, W, Hh)

def sheds(x, y, z0, h, r, n, m, rot=None):
    """Isolator mit Schirmen (Porzellan/Verbund): Kern plus abwechselnd große und kleine Schirme."""
    parts = [cyl('kern', r * 0.45, h, (x, y, z0 + h / 2), m, verts=16)]
    for k in range(n):
        rr_ = r if k % 2 == 0 else r * 0.75
        parts.append(cyl('schirm', rr_, h / n * 0.28, (x, y, z0 + (k + 0.5) * h / n), m, verts=20))
    parts.append(cyl('kappe', r * 0.55, 0.12, (x, y, z0 + h + 0.06), M['alu'], verts=16))
    return parts

def transformer(x, y):
    """Netztransformator (Freiluft, ölgefüllt): Kessel mit Versteifungen, Radiatorbatterien, Ausdehnungsgefäß,
    OS-/US-Durchführungen, Überspannungsableiter, Steuerschrank, Ölauffangwanne. Herstellerneutral."""
    P = []
    P.append(box('Fundament', (8.5, 6.5, 0.35), (x, y, 0.175), M['concrete']))
    for dx, dy, sx, sy in ((0, 3.15, 8.5, 0.2), (0, -3.15, 8.5, 0.2), (4.15, 0, 0.2, 6.5), (-4.15, 0, 0.2, 6.5)):
        P.append(box('Wannenrand', (sx, sy, 0.3), (x + dx, y + dy, 0.5), M['concrete']))
    P.append(box('Kessel', (5.6, 2.6, 3.2), (x, y, 2.05), M['tx'], bevel=0.04))
    for k in range(7):
        for sy in (-1, 1):
            P.append(box('Versteifung', (0.1, 0.08, 3.1), (x - 2.6 + k * 0.87, y + sy * 1.33, 2.05), M['tx']))
    P.append(box('Deckel', (5.8, 2.8, 0.12), (x, y, 3.71), M['tx']))
    for sy in (-1, 1):
        for k in range(12):
            P.append(box('Radiator', (0.05, 0.55, 2.5), (x - 2.2 + k * 0.4, y + sy * 1.75, 2.0), M['tx']))
        for z in (0.85, 3.15):
            P.append(cyl('Sammelrohr', 0.07, 4.8, (x, y + sy * 1.45, z), M['tx'], rot=(0, math.pi / 2, 0), verts=12))
    P.append(cyl('Ausdehnungsgefäß', 0.42, 2.6, (x - 1.8, y + 0.9, 4.75), M['tx'], rot=(0, math.pi / 2, 0), verts=24))
    for dx in (-2.8, -0.8):
        P.append(box('Konsole', (0.1, 0.1, 1.0), (x + dx, y + 0.9, 4.2), M['steel']))
    P.append(cyl('Ölleitung', 0.04, 1.0, (x - 0.5, y + 0.9, 4.25), M['tx'], verts=8))
    for k, dx in enumerate((-0.9, 0.4, 1.7)):
        P += sheds(x + dx, y - 0.6, 3.77, 2.4, 0.26, 12, M['porcelain'])
    for dx in (-0.9, 0.4, 1.7):
        P += sheds(x + dx + 0.3, y + 0.75, 3.77, 0.8, 0.14, 5, M['porcelain'])
    for dx in (-0.9, 0.4, 1.7):
        P.append(cyl('Ableitergestell', 0.08, 3.4, (x + dx, y - 4.0, 1.7), M['steel'], verts=8))
        P += sheds(x + dx, y - 4.0, 3.4, 1.6, 0.18, 9, M['composite'])
    P.append(box('Steuerschrank', (0.8, 0.5, 1.4), (x + 2.6, y - 1.6, 1.05), M['hvac']))
    P.append(box('Typschild', (0.4, 0.01, 0.3), (x + 1.2, y - 1.31, 2.4), M['label']))
    return P

def lattice_beam(p0, p1, w=1.0, h=1.2, m=None):
    """Gitterträger (Portalriegel) als Fachwerk über Wireframe-Modifikator."""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(p0 + p1) / 2)
    o = bpy.context.object; o.scale = (d.length, w, h); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler.z = math.atan2(d.y, d.x)
    sb = o.modifiers.new('s', 'SUBSURF'); sb.subdivision_type = 'SIMPLE'; sb.levels = sb.render_levels = 4
    wf = o.modifiers.new('wf', 'WIREFRAME'); wf.thickness = 0.06
    o.data.materials.append(m or M['steel']); return o

def lattice_column(x, y, h=14, w=0.9):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
    o = bpy.context.object; o.scale = (w, w, h); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sb = o.modifiers.new('s', 'SUBSURF'); sb.subdivision_type = 'SIMPLE'; sb.levels = sb.render_levels = 4
    wf = o.modifiers.new('wf', 'WIREFRAME'); wf.thickness = 0.06
    o.data.materials.append(M['steel']); return o

def substation_detail(cx, cy):
    """Umspannwerk, Detailfassung für Nahaufnahmen: zwei Transformatoren mit Brandschutzwand,
    Gitterportale mit Abspannketten, Rohrsammelschienen auf Stützisolatoren, Trenner, Schaltgebäude."""
    plane('UW-Schotter', 80, 56, (cx, cy, 0.03), M['gravel'])
    plane('UW-Fahrweg', 80, 5, (cx, cy - 15, 0.045), M['asphalt'])
    for x in (cx - 9, cx + 9):
        transformer(x, cy - 4)
    box('Brandschutzwand', (0.35, 8.0, 7.5), (cx, cy - 4, 3.75), M['firewall'])
    for px in (cx - 27, cx - 9, cx + 9, cx + 27):
        for py in (cy + 8, cy + 20):
            lattice_column(px, py)
        lattice_beam((px, cy + 8, 13.4), (px, cy + 20, 13.4))
    for py in (cy + 10, cy + 14, cy + 18):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=56, location=(cx, py, 6.2), rotation=(0, math.pi / 2, 0), vertices=16)
        o = bpy.context.object; o.data.materials.append(M['alu'])
        for px in (cx - 24, cx - 14, cx - 4, cx + 4, cx + 14, cx + 24):
            box('Stützgerüst', (0.35, 0.35, 3.0), (px, py, 1.5), M['steel'])
            for o2 in sheds(px, py, 3.0, 3.0, 0.2, 12, M['porcelain']): pass
        for px in (cx - 27, cx - 9, cx + 9, cx + 27):
            for o2 in sheds(px, py, 10.4, 1.8, 0.16, 10, M['composite']): pass
            wire([(px, py, 10.4), (px + 1.5, py, 6.25)], r=0.03, sag=0.2)
    for x in (cx - 9, cx + 9):
        for k, dx in enumerate((-0.9, 0.4, 1.7)):
            wire([(x + dx, cy - 4.6, 6.3), (x + dx, cy + 3, 7.5), (x + dx, cy + 10 + k * 4, 6.25)], r=0.035, sag=0.3)
    for py in (cy + 10, cy + 14, cy + 18):
        wire([(cx - 40, py, 13.0), (cx - 27, py, 12.8), (cx + 27, py, 12.8), (cx + 40, py, 13.0)], r=0.03, sag=0.6)
    box('Schaltgebäude', (16, 9, 5), (cx - 30, cy - 16, 2.5), M['brick'])
    box('Schaltgebäude Dach', (16.6, 9.6, 0.4), (cx - 30, cy - 16, 5.2), M['roof2'])
    fence(cx - 40, cy - 28, cx + 40, cy + 28, h=2.2)

def photo_post(vignette=0.0, dispersion=0.004):
    """Kameracharakter: leichte Farbsäume, Vignette."""
    nt = bpy.context.scene.node_tree
    comp = next(n for n in nt.nodes if n.type == 'COMPOSITE'); src = comp.inputs['Image'].links[0].from_socket
    ld = nt.nodes.new('CompositorNodeLensdist'); ld.inputs['Dispersion'].default_value = dispersion
    if not vignette:
        nt.links.new(src, ld.inputs['Image']); nt.links.new(ld.outputs['Image'], comp.inputs['Image']); return
    el = nt.nodes.new('CompositorNodeEllipseMask'); el.width = 0.95; el.height = 0.9
    bl = nt.nodes.new('CompositorNodeBlur'); bl.filter_type = 'FAST_GAUSS'; bl.use_relative = True; bl.factor_x = bl.factor_y = 0.35
    mr = nt.nodes.new('CompositorNodeMapRange'); mr.inputs['To Min'].default_value = 1 - vignette
    mu = nt.nodes.new('CompositorNodeMixRGB'); mu.blend_type = 'MULTIPLY'; mu.inputs['Fac'].default_value = 1.0
    nt.links.new(src, ld.inputs['Image']); nt.links.new(el.outputs['Mask'], bl.inputs['Image'])
    nt.links.new(bl.outputs['Image'], mr.inputs['Value']); nt.links.new(ld.outputs['Image'], mu.inputs[1]); nt.links.new(mr.outputs[0], mu.inputs[2])
    nt.links.new(mu.outputs[0], comp.inputs['Image'])

def substation(cx, cy):
    """Umspannwerk (Freiluft): zwei Netztransformatoren, Portale, Sammelschienen, Isolatoren, Schaltgebäude."""
    plane('UW-Schotter', 70, 46, (cx, cy, 0.03), M['gravel'])
    for i, x in enumerate((cx - 12, cx + 12)):
        box('Trafo', (7, 4.5, 4.6), (x, cy - 6, 2.6), M['tx'], bevel=0.05)
        for k in range(9):
            box('Rippe', (0.08, 2.6, 3.6), (x - 3.6 - k * 0.0, cy - 6 + 0, 2.4), M['tx']).location.x = x - 3.2 + k * 0.8
        box('Kühler', (6.5, 1.6, 3.4), (x, cy - 9.3, 2.4), M['tx'])
        box('Ölwanne', (9, 7, 0.4), (x, cy - 6, 0.2), M['concrete'])
        for bx in (-2, 0, 2):
            cyl('Durchführung', 0.22, 2.6, (x + bx, cy - 5, 6.2), M['insul'])
            cyl('Durchführung', 0.12, 2.0, (x + bx * 0.7, cy - 7, 5.6), M['insul'])
    for px in (cx - 26, cx - 8, cx + 8, cx + 26):
        for py in (cy + 6, cy + 16):
            cyl('Portalstütze', 0.35, 14, (px, py, 7), M['steel'], verts=8)
        box('Portalriegel', (0.8, 11, 0.8), (px, cy + 11, 14), M['steel'])
    for py in (cy + 6, cy + 16):
        for z in (11.6, 12.6, 13.6):
            pass
    for k, py in enumerate((cy + 8, cy + 11, cy + 14)):
        wire([(cx - 30, py, 12.5), (cx + 30, py, 12.5)], r=0.06, sag=0.2)
        for px in (cx - 20, cx - 4, cx + 4, cx + 20):
            cyl('Stützer', 0.15, 2.4, (px, py, 3.4), M['insul'])
            box('Gerüst', (0.3, 0.3, 2.2), (px, py, 1.1), M['steel'])
            wire([(px, py, 4.6), (px, py, 12.5)], r=0.035)
            wire([(px, py, 4.6), (px, cy - 4.5, 6.8)], r=0.04, sag=0.6)
    box('Schaltgebäude', (18, 9, 5), (cx - 30, cy - 18, 2.5), M['brick'])
    box('Schaltgebäude Dach', (18.6, 9.6, 0.5), (cx - 30, cy - 18, 5.2), M['roof2'])
    fence(cx - 35, cy - 23, cx + 35, cy + 23, h=2.2)

def fields(extent=2600):
    """Feldmosaik: Schläge mit wechselnder Kultur, getrennt durch Knicks."""
    rr = random.Random(3)
    kinds = ['crop', 'crop', 'rape', 'crop', 'plough', 'grass', 'crop', 'stubble', 'grass', 'rape']
    step = 260
    for ix in range(-extent // step, extent // step):
        for iy in range(-extent // step, extent // step):
            x = ix * step; y = iy * step
            w = step * rr.uniform(0.92, 1.0); h = step * rr.uniform(0.92, 1.0)
            o = plane('Schlag', w, h, (x, y, 0), M[rr.choice(kinds)], rot_z=rr.uniform(-0.02, 0.02))
    plane('Untergrund', extent * 3, extent * 3, (0, 0, -0.05), M['grass'])

# ------------------------------------------------------------ Licht, Himmel, Kamera
CLOUD_PLANE = False
USE_HDRI = True
HDRI_KIND = 'clear'
HDRI_STRENGTH = 1.0
HDRI = {'day': 'kloofendal_48d_partly_cloudy_puresky', 'evening': 'belfast_sunset_puresky', 'clear': 'autumn_field_puresky'}
def hdri(kind='day', rot=0.0, strength=1.0):
    w = bpy.data.worlds.new('Himmel'); bpy.context.scene.world = w; w.use_nodes = True; nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND'); bg.inputs['Strength'].default_value = strength
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, math.radians(rot))
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(f'{ASSETS}/hdris/{HDRI[kind]}/{HDRI[kind]}_4k.hdr')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bpy.context.scene.world.mist_settings.start = 200
    return env

def sky(sun_elev=14, sun_rot=215, strength=0.28, dust=1.6, air=1.0, ozone=1.0):
    if USE_HDRI:
        # sun_rot = gewünschter Sonnenazimut (Grad, mathematisch ab +X); Sonne liegt in allen drei HDRIs bei ca. 144°
        return hdri('evening' if sun_elev < 6 else HDRI_KIND, rot=144 - sun_rot, strength=HDRI_STRENGTH)
    w = bpy.data.worlds.new('Himmel'); bpy.context.scene.world = w; w.use_nodes = True
    nt = w.node_tree; bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    s = nt.nodes.new('ShaderNodeTexSky'); s.sky_type = 'NISHITA'
    s.sun_elevation = math.radians(sun_elev); s.sun_rotation = math.radians(sun_rot)
    s.air_density = air; s.dust_density = dust; s.ozone_density = ozone; s.sun_intensity = 1.0
    nt.links.new(s.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = strength
    sd = bpy.data.lights.new('Sonne', 'SUN'); sd.energy = 3.2 * min(1.0, max(0.25, sun_elev / 20)); sd.angle = math.radians(0.6)
    sd.color = (1.0, 0.86 + min(sun_elev, 30) / 300, 0.72 + min(sun_elev, 30) / 120)
    so = bpy.data.objects.new('Sonne', sd); bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(90 - sun_elev), 0, math.radians(sun_rot) + math.pi / 2)
    s.sun_disc = False
    return s

def clouds(cover=0.45, z=1600, seed=0.0):
    """Lockere Kumulusschicht (nur noch für Draufsicht: Wolkenschatten)."""
    if not CLOUD_PLANE: return
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, z))
    o = bpy.context.object; o.scale = (60000, 60000, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True); o.name = 'Wolken'
    m = bpy.data.materials.new('Wolken'); m.use_nodes = True; nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'); b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (1, 1, 1, 1); b.inputs['Roughness'].default_value = 1.0
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Location'].default_value = (seed, seed * 0.7, 0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 0.0009; n.inputs['Detail'].default_value = 12; n.inputs['Roughness'].default_value = 0.62
    nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    r = nt.nodes.new('ShaderNodeValToRGB'); r.color_ramp.elements[0].position = 1 - cover * 0.62; r.color_ramp.elements[1].position = 1 - cover * 0.62 + 0.12
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(r.outputs['Color'], mx.inputs['Fac']); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface']); o.data.materials.append(m)
    return o

def camera(loc, target, lens=35, shift_y=0.0, name='Kamera'):
    c = bpy.data.cameras.new(name); c.lens = lens; c.sensor_width = 36; c.shift_y = shift_y; c.clip_end = 20000
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o); o.location = loc
    d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o; return o

def haze(color=(0.80, 0.86, 0.92), start=200, depth=3000, amount=0.55):
    """Luftperspektive über den Nebel-Pass im Compositor."""
    sc = bpy.context.scene; vl = bpy.context.view_layer; vl.use_pass_mist = True
    sc.world.mist_settings.start = start; sc.world.mist_settings.depth = depth; sc.world.mist_settings.falloff = 'QUADRATIC'
    sc.use_nodes = True; nt = sc.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    rl = nt.nodes.new('CompositorNodeRLayers'); comp = nt.nodes.new('CompositorNodeComposite')
    mul = nt.nodes.new('CompositorNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = amount
    mix = nt.nodes.new('CompositorNodeMixRGB'); mix.inputs[2].default_value = (*color, 1)
    nt.links.new(rl.outputs['Mist'], mul.inputs[0]); nt.links.new(mul.outputs[0], mix.inputs['Fac'])
    nt.links.new(rl.outputs['Image'], mix.inputs[1]); nt.links.new(mix.outputs[0], comp.inputs['Image'])

def grass_models(x0, y0, x1, y1, n=4000, seed=3, h=(0.6, 1.1)):
    """Grasbüschel (Poly Haven grass_medium_01) als Instanzen im Vordergrund."""
    if 'grassmodel' not in PROTO:
        col = bpy.data.collections.new('Grasmodell'); bpy.context.scene.collection.children.link(col)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f'{ASSETS}/models/grass_medium_01/grass_medium_01_2k.gltf')
        for o in [o for o in bpy.data.objects if o not in before]:
            for uc in list(o.users_collection): uc.objects.unlink(o)
            col.objects.link(o)
        PROTO['grassmodel'] = col
    rr = random.Random(seed)
    pts = [((rr.uniform(x0, x1), rr.uniform(y0, y1), 0.0), (s, s, s)) for s in [rr.uniform(*h) for _ in range(n)]]
    scatter('Grasbüschel', pts, PROTO['grassmodel'])

def grass_patch(loc, size, m, count=60000, length=0.55, seed=1, color=(0.25, 0.33, 0.08)):
    """Vordergrund-Bewuchs als Haarpartikel (Getreide/Gras)."""
    o = plane('Bewuchs', size[0], size[1], loc, m)
    sub = o.modifiers.new('s', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = 3; sub.render_levels = 3
    ps = o.modifiers.new('haar', 'PARTICLE_SYSTEM').particle_system
    st = ps.settings; st.type = 'HAIR'; st.count = count; st.hair_length = length; ps.seed = seed
    st.use_advanced_hair = True; st.brownian_factor = 0.02; st.factor_random = 0.25
    st.child_type = 'INTERPOLATED'; st.rendered_child_count = 12; st.child_percent = 2; st.child_radius = 0.06; st.roughness_2 = 0.05
    st.root_radius = 0.6; st.tip_radius = 0.0; st.radius_scale = 0.004
    if hasattr(st, "length_random"): st.length_random = 0.35
    hm = bpy.data.materials.new('Halm'); hm.use_nodes = True; hb = next(n for n in hm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    hb.inputs['Base Color'].default_value = (*color, 1); hb.inputs['Roughness'].default_value = 0.6
    hb.inputs['Subsurface Weight'].default_value = 0.2
    o.data.materials.append(hm); st.material = 2
    return o

# ------------------------------------------------------------ Motive
def common_landscape(turbines=True):
    fields()
    # Knicks entlang der Schlaggrenzen in der Nähe
    rr = random.Random(11)
    for k in range(-5, 6):  # Knicknetz: nah dicht, fern lockerer (Rechenaufwand)
        dn = 0.32 if abs(k) <= 2 else 0.14
        hedge((k * 260 + 130, -1300), (k * 260 + 130, 1300), wall=True, density=dn, seed=100 + k)
        hedge((-1300, k * 260 + 130), (1300, k * 260 + 130), wall=True, density=dn, seed=200 + k)
    if turbines:
        for i, p in enumerate([(1500, 2200), (1900, 2600), (2400, 2100), (-1800, 2900), (-2300, 2500), (900, 3200), (2900, 2900)]):
            turbine(p, hub=rr.uniform(120, 150), rot=rr.uniform(0, 2), yaw=math.radians(rr.uniform(150, 210)))

def shot_hero():
    materials(); common_landscape()
    x0, y0, W, H = bess_plant(0, 0, rows=6, per_row=9)
    hedge((x0 + W + 14, y0 - 14), (x0 + W + 14, y0 + H + 14), seed=6, density=0.32)
    hedge((x0 - 14, y0 + H + 14), (x0 + W + 14, y0 + H + 14), seed=7, density=0.32)
    substation(-190, 70)
    plane('Zufahrt', 5, 150, (x0 + 3, y0 - 78, 0.04), M['asphalt'])
    plane('Kreisstraße', 2600, 6.5, (0, y0 - 155, 0.04), M['asphalt'])
    for i in range(14):
        lattice_pylon((-190 + 0, 140 + i * 320), h=52)
    for k in (-9, 0, 9):
        wire([(-190 + k, 140 + i * 320, 48) for i in range(10)], r=0.05, sag=6)
    sky(sun_elev=11, sun_rot=235, strength=0.30, dust=2.2)
    clouds(cover=0.42, seed=3000.0)
    camera((112, -128, 34), (-48, 22, 0), lens=32)
    haze(start=250, depth=3500, amount=0.3)

def shot_feld():
    materials(); common_landscape()
    x0, y0, W, H = bess_plant(0, 0, rows=6, per_row=9)
    hedge((x0 - 16, y0 - 16), (x0 + W + 16, y0 - 16), wall=False, seed=15, density=0.5, young=True)
    hedge((x0 + W + 16, y0 - 16), (x0 + W + 16, y0 + H + 16), seed=16, density=0.32)
    hedge((x0 - 16, y0 + H + 16), (x0 + W + 16, y0 + H + 16), seed=17, density=0.32)
    substation(-190, 70)
    grass_patch((70, -95, 0.01), (90, 40), M['crop'], count=160000, length=0.7, color=(0.09, 0.15, 0.03))
    sky(sun_elev=16, sun_rot=250, strength=0.32, dust=1.8)
    clouds(cover=0.4, seed=1200.0)
    grass_models(40, -112, 110, -80, n=2500, seed=4)
    camera((72, -104, 6.5), (-6, 4, 2.0), lens=36)
    haze(start=120, depth=2600, amount=0.45)

def shot_modul():
    materials()
    plane('Boden', 3000, 3000, (0, 0, -0.05), M['grass'])
    x0, y0, W, H = bess_plant(0, 0, rows=3, per_row=7)
    hedge((x0 - 14, y0 + H + 18), (x0 + W + 14, y0 + H + 18), seed=21, density=0.35, h=(8, 14))
    sky(sun_elev=22, sun_rot=60, strength=0.34, dust=1.4)
    clouds(cover=0.35, seed=800.0)
    camera((x0 + 13, y0 + 23.2, 1.7), (x0 + 60, y0 + 22.0, 1.75), lens=26)
    haze(start=200, depth=2000, amount=0.3)

def shot_modul_v2():
    """Motiv 3 v2: Nahaufnahme einer Containerreihe mit Klimageräten, Wartungstüren und PCS-Station."""
    global HDRI_KIND
    HDRI_KIND = 'day'
    materials(); common_landscape(turbines=False)
    x0, y0, W, H = bess_plant(0, 0, rows=3, per_row=7)
    hedge((x0 - 14, y0 + H + 16), (x0 + W + 14, y0 + H + 16), seed=21, density=0.35, h=(8, 14))
    hedge((x0 + W + 16, y0 - 14), (x0 + W + 16, y0 + H + 14), seed=22, density=0.35, h=(8, 13))
    x2 = x0 + 8 + 9.06 / 2 + 2 * 9.06; yr = y0 + 18
    sky(sun_elev=24, sun_rot=250)
    c = camera((x2 + 9.5, yr + 7.6, 1.6), (x2 - 14.0, yr + 6.9, 0.7), lens=28)
    c.data.dof.use_dof = True; c.data.dof.focus_distance = 6.0; c.data.dof.aperture_fstop = 4.0
    haze(start=300, depth=2500, amount=0.15)
    try: photo_post()
    except Exception as e: print("POST", e)

def shot_netz_v2():
    """Motiv 4 v2: Netztransformatoren mit Brandschutzwand vor Gitterportalen, Blick von außerhalb des Zauns."""
    global HDRI_KIND
    HDRI_KIND = 'day'
    materials(); common_landscape(turbines=True)
    substation_detail(0, 0)
    for i in range(8):
        lattice_pylon((0, 70 + i * 320), h=52)
    sky(sun_elev=24, sun_rot=225)
    c = camera((24, -19.5, 1.7), (5, -3, 4.4), lens=30)
    c.data.dof.use_dof = True; c.data.dof.focus_distance = 19; c.data.dof.aperture_fstop = 8.0
    haze(start=300, depth=3000, amount=0.2)
    try: photo_post()
    except Exception as e: print("POST", e)

def shot_netz():
    materials(); common_landscape(turbines=True)
    substation(0, 0)
    for i in range(10):
        lattice_pylon((0, 60 + i * 320), h=52)
    for k in (-9, 0, 9):
        wire([(k, 60 + i * 320, 48) for i in range(10)], r=0.05, sag=6)
    sky(sun_elev=9, sun_rot=260, strength=0.30, dust=2.4)
    clouds(cover=0.45, seed=500.0)
    camera((32, -38, 2.0), (-6, 4, 6.5), lens=26)
    haze(start=150, depth=3000, amount=0.45)

def shot_planung():
    """Senkrechte Draufsicht einer Entwicklungsfläche (Orthofoto-Anmutung); Planlinien werden beim Export überlagert."""
    materials(); common_landscape(turbines=False)
    substation(-190, 70)
    plane('Feldweg', 4, 600, (130, 0, 0.04), M['track'])
    sky(sun_elev=38, sun_rot=160, strength=0.35, dust=1.0)
    c = camera((-60, 0, 900), (-60, 0, 0), lens=50); c.data.type = 'ORTHO'; c.data.ortho_scale = 560
    c.rotation_euler = (0, 0, 0)

def shot_investor():
    materials(); common_landscape()
    x0, y0, W, H = bess_plant(0, 0, rows=8, per_row=11, lit=True)
    substation(-230, 90)
    hedge((x0 - 14, y0 - 14), (x0 + W + 14, y0 - 14), seed=31, density=0.22)
    for i in range(14):
        lattice_pylon((-230, 160 + i * 320), h=52)
    for k in (-9, 0, 9):
        wire([(-230 + k, 160 + i * 320, 48) for i in range(10)], r=0.05, sag=6)
    sky(sun_elev=3.5, sun_rot=245, strength=0.42, dust=3.0)
    clouds(cover=0.38, seed=2200.0)
    clouds(cover=0.38, seed=900.0)
    camera((-175, -150, 46), (5, 20, 0), lens=42)
    haze(color=(0.85, 0.80, 0.78), start=150, depth=3000, amount=0.5)

def village(cx, cy):
    rr = random.Random(41)
    for i in range(34):
        x = cx + rr.uniform(-160, 160); y = cy + rr.uniform(-70, 70)
        w, d, h = rr.uniform(9, 14), rr.uniform(8, 11), rr.uniform(3.2, 5.5)
        rz = rr.choice((0, math.pi / 2)) + rr.uniform(-0.1, 0.1)
        b = box('Haus', (w, d, h), (x, y, h / 2), M['brick']); b.rotation_euler.z = rz
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h + d * 0.3))
        r = bpy.context.object; r.scale = (w + 0.8, d + 0.8, d * 0.6); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for v in r.data.vertices:
            if v.co.z > 0: v.co.y = 0
        r.rotation_euler.z = rz; r.data.materials.append(rr.choice([M['roof'], M['roof'], M['roof2']]))
        if rr.random() < 0.6: tree((x + rr.uniform(-12, 12), y + rr.uniform(-12, 12)), rr.uniform(9, 16), i)
    box('Kirchenschiff', (28, 13, 11), (cx + 10, cy + 10, 5.5), M['brick'])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx + 10, cy + 10, 11 + 4))
    r = bpy.context.object; r.scale = (29, 14, 8); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for v in r.data.vertices:
        if v.co.z > 0: v.co.y = 0
    r.data.materials.append(M['roof'])
    box('Kirchturm', (7, 7, 24), (cx - 7, cy + 10, 12), M['brick'])
    cyl('Turmhelm', 5.2, 14, (cx - 7, cy + 10, 31), M['roof2'], verts=4, r2=0.1).rotation_euler.z = math.pi / 4
    box('Feuerwehrhaus', (16, 12, 7), (cx + 120, cy - 60, 3.5), M['brick'])
    for k in range(3): box('Tor', (3.6, 0.1, 4.2), (cx + 114 + k * 5, cy - 66.1, 2.1), M['beacon'])

def shot_kommune():
    materials(); common_landscape()
    village(-40, 420)
    x0, y0, W, H = bess_plant(260, 260, rows=4, per_row=7)
    hedge((x0 - 14, y0 - 14), (x0 + W + 14, y0 - 14), seed=41, density=0.3, young=True, wall=False)
    hedge((x0 - 14, y0 - 14), (x0 - 14, y0 + H + 14), seed=42, density=0.3)
    substation(520, 210)
    plane('Gemeindestraße', 6, 900, (115, 200, 0.04), M['asphalt'])
    sky(sun_elev=20, sun_rot=210, strength=0.32, dust=1.6)
    clouds(cover=0.38, seed=2600.0)
    camera((120, -40, 48), (120, 380, 0), lens=30)
    haze(start=150, depth=3000, amount=0.45)

def shot_betrieb():
    """Leitwarte: Arbeitsplatz mit Überwachungsbildschirmen; Fenster mit Blick auf die Anlage."""
    materials()
    plane('Boden draußen', 3000, 3000, (0, 0, -0.05), M['grass'])
    x0, y0, W, H = bess_plant(0, 60, rows=4, per_row=7)
    hedge((x0 - 14, y0 + H + 14), (x0 + W + 14, y0 + H + 14), seed=51, density=0.3)
    # Raum vor dem Fenster (Beobachtungsraum im Betriebsgebäude)
    ry = -6
    floor_m = mat('Bodenbelag', (0.18, 0.19, 0.2), 0.55, bump='noise', bump_scale=60, bump_strength=0.05)
    wall_m = mat('Wand', (0.82, 0.82, 0.8), 0.8)
    desk_m = mat('Tisch', (0.55, 0.47, 0.38), 0.45)
    frame_m = mat('Rahmen', (0.12, 0.12, 0.13), 0.4, 0.5)
    box('Raumboden', (14, 10, 0.2), (0, ry - 5, 2.9), floor_m)
    box('Decke', (14, 10, 0.2), (0, ry - 5, 6.3), wall_m)
    box('Wand links', (0.2, 10, 3.4), (-7, ry - 5, 4.6), wall_m)
    box('Wand rechts', (0.2, 10, 3.4), (7, ry - 5, 4.6), wall_m)
    box('Brüstung', (14, 0.3, 0.9), (0, ry, 3.45), wall_m)
    box('Sturz', (14, 0.3, 0.5), (0, ry, 6.05), wall_m)
    for x in (-4.6, -1.6, 1.4, 4.4):
        box('Pfosten', (0.12, 0.3, 2.0), (x, ry, 4.9), frame_m)
    gl = bpy.data.materials.new('Fensterglas'); gl.use_nodes = True; gb = next(n for n in gl.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    gb.inputs['Transmission Weight'].default_value = 1.0; gb.inputs['Roughness'].default_value = 0.0; gb.inputs['IOR'].default_value = 1.05
    box('Scheibe', (14, 0.02, 2.0), (0, ry, 4.9), gl)
    box('Tisch', (5.2, 1.0, 0.06), (0, ry - 1.6, 3.75), desk_m)
    box('Tischbein', (0.06, 0.8, 0.75), (-2.4, ry - 1.6, 3.35), frame_m); box('Tischbein', (0.06, 0.8, 0.75), (2.4, ry - 1.6, 3.35), frame_m)
    # Bildschirme mit Leitstandsoberfläche (synthetische Werte)
    sm = bpy.data.materials.new('Bildschirm'); sm.use_nodes = True; nt = sm.node_tree; sb = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    sb.inputs['Base Color'].default_value = (0.01, 0.01, 0.01, 1); sb.inputs['Roughness'].default_value = 0.15
    if A.tex:
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = bpy.data.images.load(A.tex)
        nt.links.new(tx.outputs['Color'], sb.inputs['Emission Color']); sb.inputs['Emission Strength'].default_value = 1.6
        sb.inputs['Coat Weight'].default_value = 0.3
    for i, (x, rz) in enumerate(((-1.6, 0.25), (0, 0), (1.6, -0.25))):
        # Gehäuse (Rückseite zum Fenster), Bildschirm zur Kamera (−Y), leicht nach hinten geneigt
        piv = Vector((x, ry - 1.85, 4.32)); rot = Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(math.radians(-5), 4, 'X')
        bpy.ops.mesh.primitive_cube_add(size=1); g = bpy.context.object; g.name = 'Monitorgehäuse'
        g.scale = (1.52, 0.05, 0.9); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        g.matrix_world = Matrix.Translation(piv) @ rot; g.data.materials.append(frame_m)
        bpy.ops.mesh.primitive_plane_add(size=1); sc_ = bpy.context.object; sc_.name = 'Bildschirm'
        sc_.scale = (1.46, 0.84, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for v in sc_.data.vertices: v.co = Vector((v.co.x, -0.026, v.co.y))   # Fläche in XZ, Normale −Y
        sc_.data.update(); sc_.matrix_world = Matrix.Translation(piv) @ rot
        uv = sc_.data.uv_layers[0].data
        for k, lp in enumerate(sc_.data.loops):
            co = sc_.data.vertices[lp.vertex_index].co
            uv[k].uv = ((co.x + 0.73) / 1.46 / 3 + i / 3, (co.z + 0.42) / 0.84)
        if sc_.data.polygons[0].normal.y > 0: bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.flip_normals(); bpy.ops.object.mode_set(mode='OBJECT')
        sc_.data.materials.append(sm)
        box('Fuß', (0.08, 0.08, 0.32), (x, ry - 1.74, 3.92), frame_m)
        box('Standplatte', (0.3, 0.22, 0.02), (x, ry - 1.74, 3.79), frame_m)
    box('Tastatur', (0.45, 0.15, 0.02), (-0.2, ry - 2.0, 3.79), frame_m)
    box('Maus', (0.06, 0.1, 0.03), (0.25, ry - 2.0, 3.79), frame_m)
    box('Sitz', (0.55, 0.55, 0.08), (0.1, ry - 2.75, 3.5), frame_m); box('Lehne', (0.55, 0.08, 0.65), (0.1, ry - 3.05, 3.9), frame_m)
    cyl('Stuhlsäule', 0.04, 0.45, (0.1, ry - 2.75, 3.22), frame_m)
    lamp = bpy.data.lights.new('Deckenlicht', 'AREA'); lamp.energy = 300; lamp.size = 4; lamp.color = (1.0, 0.95, 0.88)
    lo = bpy.data.objects.new('Deckenlicht', lamp); bpy.context.collection.objects.link(lo); lo.location = (0, ry - 5, 6.1)
    sky(sun_elev=18, sun_rot=200, strength=0.34, dust=1.6)
    clouds(cover=0.38, seed=1500.0)
    camera((1.9, ry - 5.2, 4.75), (-0.6, ry + 25, 2.8), lens=24)
    haze(start=80, depth=2000, amount=0.3)

SHOTS = {'modul2': shot_modul_v2, 'netz2': shot_netz_v2, 'hero': shot_hero, 'feld': shot_feld, 'modul': shot_modul, 'netz': shot_netz, 'planung': shot_planung,
         'investor': shot_investor, 'kommune': shot_kommune, 'betrieb': shot_betrieb}

if __name__ == '__main__':
    import time; t0 = time.time()
    reset(); SHOTS[A.shot](); flush_veg()
    print('SZENE', round(time.time() - t0), 's')
    bpy.ops.render.render(write_still=True)
    print('GERENDERT', A.shot, A.out)
