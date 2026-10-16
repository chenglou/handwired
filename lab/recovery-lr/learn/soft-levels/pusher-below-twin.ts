// The twin of levels in its variant `pusherBelow`, as a module of its own: the commands that take a twin as the path
// of a module, e.g. ../soft/check-twin.ts --twin and ../recipe.ts --twin, hand a twin no settings.
import type {Layout} from '../soft/model.ts'
import type {Twin, TwinOptions} from '../soft/twin.ts'
import {createTwin as createLevelsTwin} from './levels-twin.ts'

export const createTwin = (layout: Layout, options: TwinOptions = {}): Twin => createLevelsTwin(layout, {...options, pusherBelow: 1})
