import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type SidebarMimocodePlugin from '../../../main';
import { MimoAuxQueryRunner } from '../runtime/MimoAuxQueryRunner';

export class MimoInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: SidebarMimocodePlugin) {
    super(new MimoAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
