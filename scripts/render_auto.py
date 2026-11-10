"""Genera un auto compacto para Blender y el catálogo de Planos."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]

def material(name, color, metallic=0, roughness=.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    surface = mat.node_tree.nodes.get("Principled BSDF")
    surface.inputs["Base Color"].default_value = mat.diffuse_color
    surface.inputs["Metallic"].default_value = metallic
    surface.inputs["Roughness"].default_value = roughness
    return mat

def assign(name, mat):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj

def box(name, mat, dimensions, location, radius=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    obj = assign(name,mat)
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel = obj.modifiers.new("Aristas redondeadas",'BEVEL')
    bevel.width = radius
    bevel.segments = 3
    obj.modifiers.new("Normales ponderadas",'WEIGHTED_NORMAL')
    return obj

def cabin(paint, glass):
    base = [(-.76,-.92,.77),(.76,-.92,.77),(.76,1.31,.77),(-.76,1.31,.77)]
    roof = [(-.62,-.32,1.45),(.62,-.32,1.45),(.62,.92,1.45),(-.62,.92,1.45)]
    mesh = bpy.data.meshes.new("Cabina")
    mesh.from_pydata(base+roof,[],[(3,2,1,0),(4,5,6,7)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)])
    mesh.update()
    obj = bpy.data.objects.new("Cabina",mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(paint)
    obj.data.materials.append(glass)
    for face in mesh.polygons[2:]:
        face.material_index = 1
    return obj

def wheel(name, mat, x, y, radius, width):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=width,location=(x,y,.30),
        rotation=(0,math.pi/2,0))
    obj = assign(name,mat)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    paint = material("Azul petróleo",(.035,.30,.44),.28,.29)
    glass = material("Vidrios oscuros",(.045,.075,.102),.25,.24)
    rubber = material("Caucho",(.024,.025,.029),0,.86)
    alloy = material("Rines de aluminio",(.57,.61,.65),.72,.31)
    headlight = material("Faros",(.89,.93,1),.15,.24)
    taillight = material("Luces traseras",(.78,.025,.036),.18,.29)

    box("Carrocería",paint,(1.72,4.14,.59),(0,0,.61),.16)
    box("Parachoques delantero",rubber,(1.59,.17,.16),(0,-2.015,.40))
    box("Parachoques trasero",rubber,(1.58,.17,.16),(0,2.015,.40))
    cabin(paint,glass)
    for side in (-1,1):
        box("Faro delantero",headlight,(.41,.12,.13),(side*.55,-2.04,.70))
        box("Luz trasera",taillight,(.41,.12,.13),(side*.55,2.04,.70))
        box("Pilar lateral",paint,(.025,.09,.53),(side*.69,.33,1.08),.01)
        for y in (-1.30,1.29):
            wheel("Neumático",rubber,side*.775,y,.30,.236)
            wheel("Rin",alloy,side*.893,y,.178,.014)
    bpy.ops.object.select_all(action='DESELECT')
    for workspace in bpy.data.workspaces:
        for screen in workspace.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    view = area.spaces.active.region_3d
                    view.view_location = (0,0,.65)
                    view.view_distance = 6
                    view.view_rotation = Vector((-.82,1.5,-.86)).to_track_quat('-Z', 'Y')
                    area.spaces.active.shading.color_type = 'MATERIAL'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"blender"/"auto_compacto.blend"))
    bpy.ops.export_scene.gltf(filepath=str(ROOT/"public"/"models"/"obj_auto.glb"),export_format='GLB',export_apply=True)

if __name__ == "__main__":
    main()
