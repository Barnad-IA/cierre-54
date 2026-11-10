"""Render catalog thumbnails from the GLB files served by Planos."""
from pathlib import Path
import sys

import bpy
from mathutils import Vector

PUBLIC = Path(__file__).resolve().parents[1] / "public"
MODELS = PUBLIC / "models"
OUTPUT = PUBLIC / "thumbnails"
OUTPUT.mkdir(exist_ok=True)

def render(model_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(model_path))
    corners = [obj.matrix_world @ Vector(corner)
               for obj in scene.objects if obj.type == 'MESH'
               for corner in obj.bound_box]
    minimum = Vector(map(min, zip(*corners)))
    maximum = Vector(map(max, zip(*corners)))
    center = (minimum + maximum) / 2
    size = (maximum - minimum).length

    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = center + Vector((.82, -1.5, .86)).normalized() * (size * 3)
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    local = camera.rotation_euler.to_quaternion().inverted()
    projected = [local @ (corner - center) for corner in corners]
    left, right = min(v.x for v in projected), max(v.x for v in projected)
    bottom, top = min(v.y for v in projected), max(v.y for v in projected)
    camera.location += camera.rotation_euler.to_quaternion() @ Vector(((left+right)/2, (bottom+top)/2, 0))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(right-left, top-bottom) * 1.13
    camera.data.clip_start = max(.001, size/1000)
    camera.data.clip_end = max(100, size*6)

    for name, direction, intensity in (
        ("Key", (-.6, -1.5, 1.6), 1700),
        ("Fill", (1.1, -1, .75), 950),
        ("Rim", (.2, 1.4, 1.5), 2100),
    ):
        light = bpy.data.lights.new(name, 'AREA')
        light.energy = intensity * (size / 4)**2
        light.size = size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(direction) * size
        obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()

    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 160
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(OUTPUT / (model_path.stem + ".png"))
    bpy.ops.render.render(write_still=True)

arguments = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
paths = [MODELS / name for name in arguments] if arguments else sorted(MODELS.glob("obj_*.glb")) + [MODELS / "valla_modulo.glb"]
for model in paths:
    render(model)
