"""
Valla modular (panel de malla eslabonada + base metálica con dos sockets).
Ejecutar:  blender --background --python valla_modular.py
Genera en la misma carpeta: valla_modular.blend, valla_modular.glb, preview.png, base_detalle.png
Todas las medidas en metros; ajusta los parámetros de abajo.
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

OUT = os.path.dirname(os.path.abspath(__file__))

# ---------------- PARÁMETROS ----------------
# Base (la "pata" rectangular en el piso)
BASE_LARGO   = 1.00    # perpendicular a la valla
BASE_ANCHO   = 0.45    # paralelo a la valla
BASE_R       = 0.016   # tubo 1 1/4" aprox (Ø32 mm)
SOCKET_R     = 0.021   # tubo receptor Ø42 mm
SOCKET_ALTO  = 0.22
SOCKET_SEP   = 0.09    # distancia entre centros de los dos sockets
# Panel
PANEL_ANCHO  = 2.20    # entre centros de los postes
PANEL_ALTO   = 1.90    # altura del travesaño superior
POSTE_R      = 0.0165  # Ø33 mm, entra en el socket
RIEL_INF_Z   = 0.15
POSTE_PIE_Z  = 0.035   # el poste baja dentro del socket
# Malla eslabonada
MALLA_PASO   = 0.055   # abertura del rombo
ALAMBRE_R    = 0.0014
# Escena
N_PANELES    = 3

# ---------------- UTILIDADES ----------------
def limpiar():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def material(nombre, color, metal, rough):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m

def tubo(bm, p1, p2, r, seg=20, ext=0.0):
    """Añade un cilindro entre p1 y p2 al bmesh (ext = alargar extremos)."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    L = d.length
    if ext:
        p1 = p1 - d.normalized() * ext
        p2 = p2 + d.normalized() * ext
        L += 2 * ext
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    M = Matrix.Translation((p1 + p2) / 2) @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r,
                          depth=L, matrix=M)

def tubo_hueco(bm, p1, p2, r, grosor=0.002, seg=24):
    """Tubo con boca abierta arriba (para los sockets)."""
    p1, p2 = Vector(p1), Vector(p2)
    ri = r - grosor
    verts_o, verts_i = [], []
    for z, lst, rr in ((p1.z, verts_o, r), (p2.z, verts_o, r)):
        pass
    ring = lambda z, rr: [bm.verts.new((p1.x + rr*math.cos(2*math.pi*k/seg),
                                         p1.y + rr*math.sin(2*math.pi*k/seg), z)) for k in range(seg)]
    ob, ot = ring(p1.z, r), ring(p2.z, r)
    it, ib = ring(p2.z, ri), ring(p2.z - 0.15, ri)
    for a, b in ((ob, ot), (ot, it), (it, ib)):
        for k in range(seg):
            bm.faces.new((a[k], a[(k+1) % seg], b[(k+1) % seg], b[k]))
    bm.faces.new(list(reversed(ob)))
    bm.faces.new(ib)

def objeto_desde_bm(bm, nombre, mat, col):
    me = bpy.data.meshes.new(nombre)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(nombre, me)
    ob.data.materials.append(mat)
    col.objects.link(ob)
    return ob

# ---------------- PIEZAS ----------------
def crear_base(nombre, mat, col):
    bm = bmesh.new()
    z = BASE_R
    hx, hy = BASE_ANCHO / 2, BASE_LARGO / 2
    # marco rectangular
    tubo(bm, (-hx, -hy, z), ( hx, -hy, z), BASE_R, ext=BASE_R)
    tubo(bm, (-hx,  hy, z), ( hx,  hy, z), BASE_R, ext=BASE_R)
    tubo(bm, (-hx, -hy, z), (-hx,  hy, z), BASE_R, ext=BASE_R)
    tubo(bm, ( hx, -hy, z), ( hx,  hy, z), BASE_R, ext=BASE_R)
    # travesaño central (paralelo a la valla)
    tubo(bm, (-hx, 0, z), (hx, 0, z), BASE_R)
    # dos sockets verticales
    for sx in (-SOCKET_SEP / 2, SOCKET_SEP / 2):
        tubo_hueco(bm, (sx, 0, z), (sx, 0, z + SOCKET_ALTO), SOCKET_R)
    return objeto_desde_bm(bm, nombre, mat, col)

def crear_marco(nombre, mat, col):
    bm = bmesh.new()
    x0, x1 = 0, PANEL_ANCHO
    zt = PANEL_ALTO
    tubo(bm, (x0, 0, POSTE_PIE_Z + 0.03), (x0, 0, zt), POSTE_R, ext=0)
    tubo(bm, (x1, 0, POSTE_PIE_Z + 0.03), (x1, 0, zt), POSTE_R, ext=0)
    tubo(bm, (x0, 0, zt), (x1, 0, zt), POSTE_R, ext=POSTE_R)
    tubo(bm, (x0, 0, RIEL_INF_Z), (x1, 0, RIEL_INF_Z), POSTE_R)
    # remates esféricos en las esquinas superiores
    for x in (x0, x1):
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=POSTE_R,
                                  matrix=Matrix.Translation((x, 0, zt)))
    return objeto_desde_bm(bm, nombre, mat, col)

def crear_malla(nombre, mat, col):
    """Malla eslabonada: alambres en zigzag que se tocan con el vecino formando rombos."""
    w = MALLA_PASO
    xa, xb = POSTE_R + 0.01, PANEL_ANCHO - POSTE_R - 0.01
    za, zb = RIEL_INF_Z + POSTE_R + 0.01, PANEL_ALTO - POSTE_R - 0.01
    n_alambres = int((xb - xa) / w)
    n_pasos = int((zb - za) / w)
    cu = bpy.data.curves.new(nombre, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = ALAMBRE_R
    cu.bevel_resolution = 1
    for i in range(n_alambres):
        sp = cu.splines.new('POLY')
        sp.points.add(n_pasos)
        for k in range(n_pasos + 1):
            lado = (k + i) % 2           # fase alterna entre alambres vecinos
            x = xa + (i + lado) * w
            y = (0.003 if lado else -0.003)  # entrelazado
            sp.points[k].co = (x, y, za + k * w, 1)
    ob = bpy.data.objects.new(nombre, cu)
    ob.data.materials.append(mat)
    col.objects.link(ob)
    return ob

def curva_a_malla(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    nuevo = bpy.data.objects.new(ob.name, me)
    nuevo.matrix_world = ob.matrix_world
    for c in ob.users_collection: c.objects.link(nuevo)
    nombre = ob.name
    bpy.data.objects.remove(ob)
    nuevo.name = nombre
    return nuevo

# ---------------- ESCENA ----------------
def main():
    limpiar()
    sc = bpy.context.scene
    galv = material("Acero_galvanizado", (0.62, 0.64, 0.66), 1.0, 0.38)
    alambre = material("Alambre_galvanizado", (0.70, 0.72, 0.74), 1.0, 0.30)
    piso = material("Concreto", (0.55, 0.53, 0.50), 0.0, 0.9)

    col = bpy.data.collections.new("Valla"); sc.collection.children.link(col)
    col_pz = bpy.data.collections.new("Pieza_base"); sc.collection.children.link(col_pz)

    paso = PANEL_ANCHO + SOCKET_SEP
    # bases en cada unión (incluye extremos)
    for j in range(N_PANELES + 1):
        b = crear_base(f"Base_{j+1:02d}", galv, col)
        b.location.x = j * paso
    # paneles
    for p in range(N_PANELES):
        x0 = p * paso + SOCKET_SEP / 2
        m = crear_marco(f"Panel_{p+1:02d}_marco", galv, col)
        r = curva_a_malla(crear_malla(f"Panel_{p+1:02d}_malla", alambre, col))
        for o in (m, r):
            o.location.x = x0
    # base suelta para ver la pieza (como la foto)
    suelta = crear_base("Base_suelta", galv, col_pz)
    suelta.location = (1.4, -1.7, 0)
    suelta.rotation_euler.z = math.radians(-25)

    # piso
    bpy.ops.mesh.primitive_plane_add(size=30, location=(3, 0, 0))
    bpy.context.active_object.name = "Piso"
    bpy.context.active_object.data.materials.append(piso)

    # luz y mundo (noche con reflector, como en la foto)
    sol = bpy.data.lights.new("Reflector", 'SUN'); sol.energy = 4.0; sol.angle = math.radians(3)
    so = bpy.data.objects.new("Reflector", sol); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.world = bpy.data.worlds.new("Mundo")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.44, 0.48, 1)
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

    # cámara
    cam = bpy.data.objects.new("Camara", bpy.data.cameras.new("Camara"))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 32

    def apuntar(pos, objetivo):
        cam.location = pos
        cam.rotation_euler = (Vector(objetivo) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()

    # render
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    sc.render.film_transparent = False

    apuntar((-2.2, -6.2, 2.6), (3.2, 0, 0.8))
    sc.render.filepath = os.path.join(OUT, "preview.png")
    bpy.ops.render.render(write_still=True)

    apuntar((0.2, -2.9, 1.1), (1.4, -1.7, 0.08))
    cam.data.lens = 45
    sc.render.filepath = os.path.join(OUT, "base_detalle.png")
    bpy.ops.render.render(write_still=True)

    apuntar((-2.2, -6.2, 2.6), (3.2, 0, 0.8)); cam.data.lens = 32
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "valla_modular.blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "valla_modular.glb"),
                              export_format='GLB', use_selection=False)
    print("OK ->", OUT)

main()

