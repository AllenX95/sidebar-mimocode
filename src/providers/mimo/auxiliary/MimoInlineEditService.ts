import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type SidebarMimocodePlugin from '../../../main';
import { MimoAuxQueryRunner } from '../runtime/MimoAuxQueryRunner';

export class MimoInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: SidebarMimocodePlugin) {
    super(new MimoAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
