"""
Exporta las piezas sueltas de la valla para usarlas en la web (three.js).
Ejecutar:  blender --background valla_modular.blend --python exportar_piezas.py
Genera ../public/models/valla_panel.glb y valla_base.glb
  - valla_panel.glb: marco + malla, origen en el poste izquierdo, a lo largo de +X
  - valla_base.glb : base con sockets, origen en el centro, sockets a lo largo de X
"""
import bpy, os

AQUI = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(AQUI, "..", "public", "models")
os.makedirs(DEST, exist_ok=True)

def exportar(nombres, archivo):
    bpy.ops.object.select_all(action='DESELECT')
    guardado = {}
    for n in nombres:
        ob = bpy.data.objects[n]
        guardado[n] = ob.location.copy()
        ob.location = (0, 0, 0)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(DEST, archivo), export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True)
    for n, loc in guardado.items():
        bpy.data.objects[n].location = loc

exportar(["Panel_01_marco", "Panel_01_malla"], "valla_panel.glb")
exportar(["Base_01"], "valla_base.glb")
print("PIEZAS OK ->", DEST)
