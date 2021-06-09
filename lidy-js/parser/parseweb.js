import { Ctx } from './lidyctx.js'
import { LidyError } from './errors.js'
import { ScalarParser } from './scalarparser.js'
import { OneOfParser } from './oneofparser.js'
import { InParser } from './inparser.js'
import { RegexParser } from './regexparser.js'
import { MapParser } from './mapparser.js'
import { ListParser } from './listparser.js'
import { parse as yaml_parse, parseDocument, isMap, LineCounter } from 'yaml'
import { RuleParser } from './ruleparser.js'
import { isScalarType} from './utils.js'

export function parse_rule(ctx, rule_name, rule, current) {
  if (rule_name) { 
    return RuleParser.parse(ctx, rule_name, rule, current)
  }
  if ( isScalarType(rule) ) {
    return ScalarParser.parse(ctx, rule, current)
  } 
  if ( typeof(rule) == 'object' ) {
    if (rule._map || rule._mapOf || rule._mapFacultative || rule._merge) {
      return MapParser.parse(ctx, rule, current)
    }
    if (rule._list || rule._listOf || rule._listFacultative) {
      return ListParser.parse(ctx, rule, current)
    }
    if (rule._oneOf) {
      return OneOfParser.parse(ctx, rule, current) 
    }
    if (rule._regex) {
      return RegexParser.parse(ctx, rule, current)
    }
    if (rule._in) {
      return InParser.parse(ctx, rule, current)
    }
  }
  ctx.grammarError(`Error : grammar error : no valid keyword found`)
  return null

}

export function parse_rule_name(ctx, rule_name, current) {
  // 'ctx' is the context of Lidy
  // 'rule_name' is the name of the grammar rule to be used
  let rule = ctx.rules[rule_name]
  if (rule === undefined) { 
    ctx.grammarError(`no rule named ${rule_name} found.`)
  } else {
    return parse_rule(ctx, rule_name, rule, current)
  }
  return null
}

function parse_lidy(ctx, rule_name, current) {      // dsl parsing of the source code
  let lidyNode = parse_rule_name(ctx, rule_name, current)

  // insert position and complete messages into errors and warnings
  ctx.errors.filter(x => x instanceof LidyError).forEach(x => x.pretty(ctx))
  ctx.warnings.filter(x => x instanceof LidyError).forEach(x => x.pretty(ctx))

  ctx.contents = lidyNode
  return ctx
}

// Parsing of grammar rules
function parse_dsl(ctx, dsl_data, top_rule) {
  // 'ctx' is the context of Lidy
  // 'dsl_data' is the textual contents of the grammar (lidy rules in YAML format) 
  // 'top_rules is the label of top level rule to be used as entry point by Lidy 
  try {
    ctx.rules = yaml_parse(dsl_data)
  } catch (error) {
    ctx.errors.push(error)
    throw ctx.grammarError("ERROR : can not parse dsl ")
  }
  if (!typeof(ctx.rules) == 'object') {
    throw ctx.grammarError("ERROR : can not parse dsl ")
  }
  if (! ctx.rules[top_rule]) throw Error("ERROR : no rule labeled '" + top_rule + "' in the grammar")
}

// First step of parsing for the source code : only YAML pasing
function parse_src(ctx, src_data) {
  // 'ctx' is the context of Lidy
  // 'src_data' is the textual contents of the source code 
  ctx.lineCounter = new LineCounter()
  let src_doc = parseDocument(src_data, {lineCounter: ctx.lineCounter})
  if ( ! src_doc ) ctx.fileError("can not parse the provided source code.")
  ctx.src = src_doc.contents
  ctx.txt = src_data
  ctx.errors   = src_doc.errors
  ctx.warnings = src_doc.warnings
  ctx.yaml_ok  = (ctx.errors.length == 0) && (ctx.warnings.length == 0)
}

// main lidy function to parse source code using lidy grammar
export function parse(input) { 
  // input is an object with two attributes :
  //  - one to provide the source code to code, 
  //    'src_data' depending on whether you want to indicate a text.
  //  - one to provide the lidy grammar to use,  
  //    'dsl_data' depending on whether you want to indicate a text.
  if (input.dsl_data == null) { throw Error("No dsl definition found from provided input") }

  if (input.dsl_data == null) { throw Error("No source code found from provided input") }

  if (!input.keyword) input.keyword = 'main' // use 'top' rule of the grammat as entry point if none is provided

  let ctx = new Ctx() // initialise context

  parse_dsl(ctx, input.dsl_data, input.keyword) // yaml parsing of the grammar rules
  parse_src(ctx, input.src_data)                // yaml parsing of the source code 
  return parse_lidy(ctx, input.keyword, ctx.src)       // dsl parsing of the source code

}

