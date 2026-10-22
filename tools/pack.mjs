// Makes the baked GLB small for the game: small vertex types, then EXT_meshopt_compression.
// POSITION stays float, because the shaders read the bind position in character units.
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

// Integer ids and bone indices: one byte each.
const BYTE_ATTRIBUTES = ['_MAT', '_GROUP', '_LINE', 'JOINTS_0'];
// Unit vectors: signed bytes. The NORMAL octahedral filter of EXT_meshopt_compression also uses 8 bits.
const UNIT_ATTRIBUTES = ['_OUTLINE'];

export async function pack(glb) {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(glb);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const name of BYTE_ATTRIBUTES) {
        const a = prim.getAttribute(name);
        if (a.getArray().some(x => x < 0 || x > 255 || x !== Math.round(x))) throw new Error(`${name} does not fit in a byte`);
        a.setArray(new Uint8Array(a.getArray()));
      }
      for (const name of UNIT_ATTRIBUTES) {
        const a = prim.getAttribute(name);
        a.setArray(Int8Array.from(a.getArray(), x => Math.round(x * 127))).setNormalized(true);
      }
    }
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return io.writeBinary(doc);
}
