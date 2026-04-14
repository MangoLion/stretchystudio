"""Test girl model with SWAPPED vertex_counts and position_index_counts."""

import sys
sys.stdout.reconfigure(encoding='utf-8')
import ctypes
from moc3 import Moc3

ALIGN = 64
dll = ctypes.CDLL('D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll')
dll.csmHasMocConsistency.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
dll.csmHasMocConsistency.restype = ctypes.c_int32
dll.csmReviveMocInPlace.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
dll.csmReviveMocInPlace.restype = ctypes.c_void_p
dll.csmGetSizeofModel.argtypes = [ctypes.c_void_p]
dll.csmGetSizeofModel.restype = ctypes.c_uint32
dll.csmInitializeModelInPlace.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32]
dll.csmInitializeModelInPlace.restype = ctypes.c_void_p
dll.csmGetDrawableCount.argtypes = [ctypes.c_void_p]
dll.csmGetDrawableCount.restype = ctypes.c_int32
dll.csmGetDrawableVertexCounts.argtypes = [ctypes.c_void_p]
dll.csmGetDrawableVertexCounts.restype = ctypes.POINTER(ctypes.c_int32)
dll.csmGetDrawableVertexPositions.argtypes = [ctypes.c_void_p]
dll.csmGetDrawableVertexPositions.restype = ctypes.POINTER(ctypes.POINTER(ctypes.c_float))
dll.csmGetDrawableVertexUvs.argtypes = [ctypes.c_void_p]
dll.csmGetDrawableVertexUvs.restype = ctypes.POINTER(ctypes.POINTER(ctypes.c_float))
dll.csmUpdateModel.argtypes = [ctypes.c_void_p]
dll.csmUpdateModel.restype = None
dll.csmResetDrawableDynamicFlags.argtypes = [ctypes.c_void_p]
dll.csmResetDrawableDynamicFlags.restype = None

def alloc_aligned(size):
    raw = ctypes.create_string_buffer(size + ALIGN)
    addr = ctypes.addressof(raw)
    aligned = (addr + ALIGN - 1) & ~(ALIGN - 1)
    return raw, ctypes.c_void_p(aligned)

girl = Moc3.from_file('D:/renpy-8.5.0-sdk/live2dtest/game/images/girl/girl.moc3')
base = Moc3.from_file('D:/renpy-8.5.0-sdk/live2dtest/game/images/Hiyori/runtime/hiyori_pro_t11.moc3')

n_m = 20
n_p = 10

# In original girl.moc3 (written by JS writer):
#   "vertex_counts" = mesh.vertices.length = unique verts = [40,27,23,...]
#   "position_index_counts" = mesh.triangles.length*3 = flat indices = [168,81,63,...]
#
# Correct mapping (from Hiyori analysis):
#   position_index_counts = rendering vertex count = unique verts
#   vertex_counts = flat index count

correct_pic = girl['art_mesh.vertex_counts']       # [40,27,23,...] -> pic
correct_vc = girl['art_mesh.position_index_counts'] # [168,81,63,...] -> vc

# Cross-refs: uv_begin = cumul(pic*2), pib = cumul(vc)
uv_begin = []
c = 0
for v in correct_pic:
    uv_begin.append(c)
    c += v * 2

pib = []
c = 0
for v in correct_vc:
    pib.append(c)
    c += v

kfp_begin = []
c = 0
for v in correct_pic:
    kfp_begin.append(c)
    c += v * 2

total_uvs = sum(v * 2 for v in correct_pic)
total_pidx = sum(correct_vc)
total_kfp = sum(v * 2 for v in correct_pic)

print(f"pic (render verts): {correct_pic[:3]}...")
print(f"vc (flat indices): {correct_vc[:3]}...")
print(f"totals: uvs={total_uvs} pidx={total_pidx} kfp={total_kfp}")

# Build model from Hiyori base
N_BANDS = n_m + n_p
base.counts[:] = [n_p,0,0,0,n_m,1,n_p,0,0,n_m,
                  total_kfp,n_m,N_BANDS,n_m,n_m,total_uvs,total_pidx,1,1,n_m,0,0,0]

base['part.ids'] = girl['part.ids']
base['part.keyform_binding_band_indices'] = [n_m+j for j in range(n_p)]
base['part.keyform_begin_indices'] = list(range(n_p))
base['part.keyform_counts'] = [1]*n_p
base['part.visibles'] = [1]*n_p
base['part.enables'] = [1]*n_p
base['part.parent_part_indices'] = [-1]*n_p

for s in ['deformer.ids','deformer.keyform_binding_band_indices',
          'deformer.visibles','deformer.enables','deformer.parent_part_indices',
          'deformer.parent_deformer_indices','deformer.types','deformer.specific_indices',
          'warp_deformer.keyform_binding_band_indices','warp_deformer.keyform_begin_indices',
          'warp_deformer.keyform_counts','warp_deformer.vertex_counts',
          'warp_deformer.rows','warp_deformer.cols',
          'rotation_deformer.keyform_binding_band_indices',
          'rotation_deformer.keyform_begin_indices','rotation_deformer.keyform_counts',
          'rotation_deformer.base_angles']:
    base[s] = []

base['art_mesh.ids'] = girl['art_mesh.ids']
base['art_mesh.keyform_binding_band_indices'] = list(range(n_m))
base['art_mesh.keyform_begin_indices'] = list(range(n_m))
base['art_mesh.keyform_counts'] = [1]*n_m
base['art_mesh.visibles'] = [1]*n_m
base['art_mesh.enables'] = [1]*n_m
base['art_mesh.parent_part_indices'] = girl['art_mesh.parent_part_indices']
base['art_mesh.parent_deformer_indices'] = [-1]*n_m
base['art_mesh.texture_indices'] = girl['art_mesh.texture_indices']
base['art_mesh.drawable_flags'] = [4]*n_m
base['art_mesh.position_index_counts'] = correct_pic
base['art_mesh.vertex_counts'] = correct_vc
base['art_mesh.uv_begin_indices'] = uv_begin
base['art_mesh.position_index_begin_indices'] = pib
base['art_mesh.mask_begin_indices'] = [0]*n_m
base['art_mesh.mask_counts'] = [0]*n_m

base['parameter.ids'] = ['ParamOpacity']
base['parameter.max_values'] = [1.0]
base['parameter.min_values'] = [0.0]
base['parameter.default_values'] = [1.0]
base['parameter.repeats'] = [0]
base['parameter.decimal_places'] = [1]
base['parameter.keyform_binding_begin_indices'] = [0]
base['parameter.keyform_binding_counts'] = [n_m]

base['part_keyform.draw_orders'] = [500.0]*n_p
for s in ['warp_deformer_keyform.opacities','warp_deformer_keyform.keyform_position_begin_indices',
          'rotation_deformer_keyform.opacities','rotation_deformer_keyform.angles',
          'rotation_deformer_keyform.origin_xs','rotation_deformer_keyform.origin_ys',
          'rotation_deformer_keyform.scales','rotation_deformer_keyform.reflect_xs',
          'rotation_deformer_keyform.reflect_ys']:
    base[s] = []

base['art_mesh_keyform.opacities'] = [1.0]*n_m
base['art_mesh_keyform.draw_orders'] = [500.0]*n_m
base['art_mesh_keyform.keyform_position_begin_indices'] = kfp_begin

base['keyform_position.xys'] = girl['keyform_position.xys']
base['uv.xys'] = girl['uv.xys']
base['position_index.indices'] = girl['position_index.indices']

base['keyform_binding_band.begin_indices'] = list(range(n_m)) + [0]*n_p
base['keyform_binding_band.counts'] = [1]*n_m + [0]*n_p
base['keyform_binding_index.indices'] = list(range(n_m))
base['keyform_binding.keys_begin_indices'] = list(range(n_m))
base['keyform_binding.keys_counts'] = [1]*n_m
base['keys.values'] = [1.0]*n_m

base['drawable_mask.art_mesh_indices'] = [-1]
base['draw_order_group.object_begin_indices'] = [0]
base['draw_order_group.object_counts'] = [n_m]
base['draw_order_group.object_total_counts'] = [n_m]
base['draw_order_group.min_draw_orders'] = [1000]
base['draw_order_group.max_draw_orders'] = [200]
base['draw_order_group_object.types'] = [0]*n_m
base['draw_order_group_object.indices'] = list(range(n_m-1,-1,-1))
base['draw_order_group_object.group_indices'] = [-1]*n_m

for s in ['glue.ids','glue.keyform_binding_band_indices','glue.keyform_begin_indices',
          'glue.keyform_counts','glue.art_mesh_index_as','glue.art_mesh_index_bs',
          'glue.info_begin_indices','glue.info_counts','glue_info.weights',
          'glue_info.position_indices','glue_keyform.intensities']:
    base[s] = []
base['additional.quad_transforms'] = []

base.canvas.pixels_per_unit = 1280.0
base.canvas.origin_x = 640.0
base.canvas.origin_y = 640.0
base.canvas.canvas_width = 1280.0
base.canvas.canvas_height = 1280.0

dst = 'D:/renpy-8.5.0-sdk/live2dtest/game/images/girl/girl_v4.moc3'
base.to_file(dst)

with open(dst, 'rb') as f:
    data = bytearray(f.read())
data.extend(bytearray(64))
with open(dst, 'wb') as f:
    f.write(data)

# Test
padded_size = (len(data) + ALIGN - 1) & ~(ALIGN - 1)
moc_raw, moc_ptr = alloc_aligned(padded_size)
ctypes.memmove(moc_ptr, bytes(data), len(data))

result = dll.csmHasMocConsistency(moc_ptr, padded_size)
print(f"\nConsistency: {result} (1=OK)")

if result == 1:
    moc_obj = dll.csmReviveMocInPlace(moc_ptr, padded_size)
    model_size = dll.csmGetSizeofModel(moc_obj)
    model_raw, model_ptr = alloc_aligned(model_size)
    model = dll.csmInitializeModelInPlace(moc_obj, model_ptr, model_size)
    dc = dll.csmGetDrawableCount(model)
    vcs = dll.csmGetDrawableVertexCounts(model)
    print(f"Drawables: {dc}")
    print(f"Vertex counts (first 5): {[vcs[i] for i in range(min(5, dc))]}")

    dll.csmUpdateModel(model)
    dll.csmResetDrawableDynamicFlags(model)
    positions = dll.csmGetDrawableVertexPositions(model)
    uvs = dll.csmGetDrawableVertexUvs(model)

    for i in range(min(3, dc)):
        vc_i = vcs[i]
        if vc_i > 0 and positions[i]:
            p = positions[i]
            u = uvs[i]
            print(f"  D{i}: {vc_i}v pos=({p[0]:.4f},{p[1]:.4f}) uv=({u[0]:.4f},{u[1]:.4f})")

    print(f"\n*** SUCCESS! {dc} drawables! ***")
else:
    print("FAILED")
