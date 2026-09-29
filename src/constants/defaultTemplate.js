import { FIELD_TYPE } from './enums'

// PRD 4.1 + 第 14 章附录：默认流程模板（7 个节点）。
// 落地后由业务在"流程模板配置"中自行调整，此文件仅提供初始值。

export const DEFAULT_TEMPLATE_VERSION = 1
export const TEMPLATE_NAME = '默认流程'

/**
 * 生成一份全新的默认模板。
 * @param {{createdBy?: string, createdAt?: string}} [options]
 */
export function createDefaultTemplate(options = {}) {
  const { createdBy = '', createdAt = new Date().toISOString() } = options
  return {
    version: DEFAULT_TEMPLATE_VERSION,
    name: TEMPLATE_NAME,
    createdAt,
    createdBy,
    nodes: [
      {
        id: 'n1',
        name: '询价/报价',
        order: 1,
        staleDays: 7,
        fields: [
          { id: 'f1', name: '报价有效期', type: FIELD_TYPE.DATE, required: true },
          {
            id: 'f2',
            name: '客户是否已回复',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['已回复', '未回复', '催办中'],
          },
          { id: 'f3', name: '备注', type: FIELD_TYPE.TEXTAREA, required: false, maxLength: 500 },
        ],
      },
      {
        id: 'n2',
        name: '送样/打样',
        order: 2,
        staleDays: 14,
        fields: [
          { id: 'f4', name: '送样日期', type: FIELD_TYPE.DATE, required: true },
          {
            id: 'f5',
            name: '样件状态',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['已寄出', '测试中', '已认可', '未通过'],
          },
          { id: 'f6', name: '客户反馈', type: FIELD_TYPE.TEXTAREA, required: false, maxLength: 500 },
        ],
      },
      {
        id: 'n3',
        name: '定点/立项',
        order: 3,
        staleDays: 14,
        fields: [
          { id: 'f7', name: '定点日期', type: FIELD_TYPE.DATE, required: true },
          { id: 'f8', name: '客户项目号', type: FIELD_TYPE.TEXT, required: false, maxLength: 100 },
          {
            id: 'f9',
            name: '预计年用量',
            type: FIELD_TYPE.NUMBER,
            required: false,
            min: 0,
          },
        ],
      },
      {
        id: 'n4',
        name: '小批量试产/PPAP',
        order: 4,
        staleDays: 21,
        fields: [
          { id: 'f10', name: '试装日期', type: FIELD_TYPE.DATE, required: true },
          {
            id: 'f11',
            name: 'PPAP 状态',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['未开始', '进行中', '已通过', '未通过'],
          },
          { id: 'f12', name: '问题点', type: FIELD_TYPE.TEXTAREA, required: false, maxLength: 1000 },
        ],
      },
      {
        id: 'n5',
        name: '量产供货',
        order: 5,
        staleDays: 30,
        fields: [
          { id: 'f13', name: 'SOP 日期', type: FIELD_TYPE.DATE, required: true },
          {
            id: 'f14',
            name: '供货状态',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['正常', '预警', '停线'],
          },
        ],
      },
      {
        id: 'n6',
        name: '对账/开票/回款',
        order: 6,
        staleDays: 30,
        fields: [
          { id: 'f15', name: '对账月份', type: FIELD_TYPE.TEXT, required: true, maxLength: 20 },
          {
            id: 'f16',
            name: '回款状态',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['未开票', '已开票', '部分回款', '已回款'],
          },
          // 注：PRD TBD-01 已决策不记录金额，此处只记录回款日期
          { id: 'f17', name: '回款日期', type: FIELD_TYPE.DATE, required: false },
        ],
      },
      {
        id: 'n7',
        name: '已关闭',
        order: 7,
        staleDays: 0,
        fields: [
          {
            id: 'f18',
            name: '关闭原因',
            type: FIELD_TYPE.SELECT,
            required: true,
            options: ['成交', '丢单'],
          },
          { id: 'f19', name: '关闭说明', type: FIELD_TYPE.TEXTAREA, required: false, maxLength: 500 },
        ],
      },
    ],
  }
}

/** 深拷贝模板，用于生成项目快照（PRD 6.4 flowSnapshot）。 */
export function cloneTemplate(template) {
  return JSON.parse(JSON.stringify(template))
}
