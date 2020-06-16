import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'
import { default as YMap } from 'yaml/dist/schema/Map'
import { default as YSeq } from 'yaml/dist/schema/Seq'
import { default as YPair } from 'yaml/dist/schema/Pair'
import { default as YScalar } from 'yaml/dist/schema/Scalar'
import { default as LineColumn } from 'line-column'

interface Info {
    classes: Record<string, new (yamlObject: any, info: Info) => any>
    dsl_tree: any
    filename: string
    index: any
    nodes: any
    src_tree: any
    typed_rules: any

    dsl: undefined // legacy bug
}

interface WithRange {
    range: [number, number]
}

interface LineCol {
    line: number
    col: number
}

function ymap_has_all(tree, keys) {
    for (const key of keys) {
        let items = key.split('|')
        let found = false
        for (const item of items) {
            if ((found = tree.has(item))) break
        }
        if (!found) return false
    }
    return true
}

function _newTimestamp(tree) {
    let timestamp: any = NaN
    if (tree instanceof YScalar) {
        try {
            timestamp = Date.parse(tree.value)
        } catch (erreur) {}
        if (isNaN(timestamp)) timestamp = null
        else timestamp.range = tree.range
    }
    return timestamp
}

function _newBoolean(tree) {
    let bool_val = null
    if (
        tree instanceof YScalar &&
        (tree.value === true || tree.value === false)
    ) {
        bool_val = new Boolean(true)
        bool_val.range = tree.range
    }
    return bool_val
}

function _newUnbounded(tree) {
    let unbounded = null
    if (
        tree instanceof YScalar &&
        typeof tree.value == 'string' &&
        tree.value.toLowerCase() == 'unbounded'
    ) {
        unbounded = new Number(Infinity)
        unbounded.range = tree.range
        unbounded.isUnbounded = true
        unbounded.isInteger = true
        unbounded.isFloat = true
    }
    return unbounded
}

function _newString(tree): (String & WithRange) | null {
    let str: (String & WithRange) | null = null
    if (
        tree instanceof YScalar &&
        (typeof tree.value === 'string' || typeof tree.value === 'number')
    ) {
        str = new String(tree.value) as any
        str.range = tree.range
    }
    return str
}

function _newInteger(tree) {
    let num = null
    if (
        tree instanceof YScalar &&
        typeof tree.value == 'number' &&
        Number.isInteger(tree.value)
    ) {
        num = new Number(tree.value)
        num.range = tree.range
        num.isUnbounded = false
        num.isInteger = true
        num.isFloat = false
    }
    return num
}

function _newFloat(tree) {
    let num = null
    if (
        tree instanceof YScalar &&
        typeof tree.value == 'number' &&
        !Number.isInteger(tree.value)
    ) {
        num = new Number(tree.value)
        num.range = tree.range
        num.isUnbounded = false
        num.isInteger = false
        num.isFloat = true
    }
    return num
}

function _newList(tree) {
    let list_array = null
    if (tree instanceof YSeq) {
        list_array = tree.items.map((x) => _parseRuleAnyYaml(x))
        list_array.range = tree.range
    }
    return list_array
}

function _newMap(tree) {
    let map = null
    if (tree instanceof YMap) {
        map = new Map()
        for (const item of tree.items) {
            let key = item.key.value
            let value = item.value
            map.set(key, _parseRuleAnyYaml(value))
        }
        map.range = tree.range
        return map
    }
}

function _locate(info: Info, range) {
    let begin = info.index.fromIndex(range[0] > 1 ? range[0] : 0)
    let end = info.index.fromIndex(range[1] > 1 ? range[1] : 0)
    let loc_str = ` at ${begin.line}:${begin.col} <-> ${end.line}:${end.col} ${
        info.filename ? 'in ' + info.filename : ''
    }`
    return loc_str
}

function _parseAtomic(tree, rule_def, keyword, info) {
    let res = null

    switch (rule_def) {
        case 'null':
            if (!(tree instanceof YScalar && tree.value === null))
                throw SyntaxError(
                    `'Should be null value in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'timestamp':
            res = _newTimestamp(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a timestamp in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'boolean':
            res = _newBoolean(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a boolean in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'unbounded':
            res = _newUnbounded(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be 'unbounded' in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'int':
            res = _newInteger(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be an int in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'float':
            res = _newFloat(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a float in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'list':
            res = _newList(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a list in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'map':
            res = _newMap(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a map in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'str':
            res = _newString(tree)
            if (!res)
                throw SyntaxError(
                    `'Should be a string in ( ${keyword} ) ! ${_locate(
                        info,
                        tree.range,
                    )}`,
                )
            break
        case 'any':
            res = _parseRuleAnyYaml(tree)
            break
    }
    if (res) return _dslObject(res, rule_def, info)
    else return parseDsl(tree, info, rule_def)
}

function _parseRuleAnyYaml(src_st) {
    let res = null
    if (!res) res = _newList(src_st)
    if (!res) res = _newMap(src_st)
    if (!res) res = _newBoolean(src_st)
    if (!res) res = _newUnbounded(src_st)
    if (!res) res = _newInteger(src_st)
    if (!res) res = _newFloat(src_st)
    if (!res) res = _newString(src_st)
    if (!res) res = _newTimestamp(src_st)
    return res
}

function _copyDict(rule_def, info: Info, keyword) {
    let copy_rule = rule_def['_copy']
    if (!copy_rule) return rule_def
    let to_copy_dict = copy_rule && info.dsl_tree[copy_rule]
    let to_copy_flat_dict =
        to_copy_dict && _copyDict(to_copy_dict, info.dsl, keyword) // bug

    let new_rule = Object.assign({}, rule_def)
    if ('_required' in new_rule) new_rule._required = [...new_rule._required]

    if ('_dictOf' in new_rule)
        if ('_dictOf' in to_copy_flat_dict)
            throw SyntaxError(
                `Error in grammar : '_dictOf' exists in both rule and copied rule (${keyword})`,
            )
        else if ('_dictOf' in to_copy_flat_dict)
            new_rule._dictOf = to_copy_flat_dict._dictOf

    if ('_dict' in new_rule) new_rule._dict = Object.assign({}, new_rule._dict)
    else if ('_dict' in to_copy_flat_dict) new_rule._dict = {}

    if (to_copy_flat_dict._dict) {
        for (const key in to_copy_flat_dict._dict) {
            if (key in new_rule._dict)
                throw SyntaxError(
                    `Error in grammar : key ${key} exists in both rule and copied rule (${keyword})`,
                )
            else new_rule._dict[key] = to_copy_flat_dict._dict[key]
        }
    }

    return new_rule
}

function _parseRuleMap(tree, rule_def, keyword, info) {
    if (!tree || (tree instanceof YScalar && tree.comment)) tree = new YMap()
    if (!(tree instanceof YMap))
        throw SyntaxError(
            `'Should be a map  ( ${keyword} )  ! ${_locate(info, tree.range)}`,
        )

    // apply (recursive) copy if 'copy' keyword exists
    rule_def = _copyDict(rule_def, info, keyword)

    // required
    let required = rule_def['_required'] || []
    if (!ymap_has_all(tree, required))
        throw SyntaxError(
            `'${required.join(', ')}' element${
                required.length > 1 ? 's are' : ' is'
            } required in a ${keyword} ${_locate(info, tree.range)}`,
        )

    // cardinality
    let nb = rule_def['_nb']
    let max = rule_def['_max']
    let min = rule_def['_min']
    let nb_items = tree.items.length
    if (nb && nb_items != nb)
        throw SyntaxError(
            `'this map should have ${nb} element${
                nb > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )
    if (max && nb_items > max)
        throw SyntaxError(
            `'this map should have at most ${max} element${
                nb > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )
    if (min && nb_items < min)
        throw SyntaxError(
            `'this map should have at least ${min} element${
                min > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )

    // schemas of elements
    let defaults = rule_def['_defaults'] || {}
    let dict = rule_def['_dict']
    let ele_key, ele_val
    let dictOf = rule_def['_dictOf']

    if (dictOf && Object.keys(dictOf).length == 1) {
        ele_key = Object.keys(dictOf)[0]
        ele_val = Object.values(dictOf)[0]
    } else dictOf = null

    let map: Map<any, any> & WithRange = new Map() as any
    map.range = tree.range
    for (const item of tree.items) {
        if (item instanceof YPair) {
            let pair_key = item && item.key
            let key = pair_key.value
            let pair_value = item && item.value
            let parsed_key, parsed_val
            if (dict && key in dict) {
                parsed_val =
                    parseRule(pair_value, dict[key], keyword, info) ||
                    defaults[key]
                map.set(key, parsed_val)
            } else {
                if (ele_key && ele_val) {
                    parsed_key = parseRule(pair_key, ele_key, keyword, info)
                    parsed_val =
                        parseRule(pair_value, ele_val, keyword, info) ||
                        defaults[key]
                    map.set(parsed_key, parsed_val)
                } else {
                    let message = `'${key}' is not allowed inside of '${keyword}' ${_locate(
                        info,
                        tree.range,
                    )}`
                    throw SyntaxError(message)
                }
            }
        }
    }

    return map
}

function _parseRuleList(tree, rule_def, keyword, info) {
    if (!tree || (tree instanceof YScalar && tree.comment)) tree = new YSeq()
    if (!(tree instanceof YSeq))
        throw SyntaxError(
            `'Should be a list  ( ${keyword} ) ${_locate(info, tree.range)} !`,
        )

    // cardinality
    let nb = rule_def['_nb']
    let max = rule_def['_max']
    let min = rule_def['_min']
    let nb_items = tree.items.length
    if (nb && nb_items !== nb)
        throw SyntaxError(
            `'this map should have ${nb} element${
                nb > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )
    if (max && nb_items > max)
        throw SyntaxError(
            `'this map should have at most ${max} element${
                nb > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )
    if (min && nb_items < min)
        throw SyntaxError(
            `'this map should have at least ${min} element${
                min > 1 ? 's ' : ' '
            }(${nb_items} provided) ${_locate(info, tree.range)}`,
        )

    // schemas of elements
    let optional = rule_def['_optional'] || []
    //let defaults = rule_def["defaults"] || {}
    let list = rule_def['_list']
    let listOf = rule_def['_listOf']

    tree.value = []
    let idx = 0
    let lst_nb = (list && list.length) || 0
    let item
    let parsed_item
    let parsed_ok = true

    let list_array: any[] & WithRange = [] as any
    list_array.range = tree.range

    if (list) {
        for (let lst_idx = 0; lst_idx < lst_nb; lst_idx++) {
            if (parsed_ok == true) {
                item = tree.items[idx]
                idx++
            }
            let def_ele = list[lst_idx]
            let is_optional = optional.includes(lst_idx + 1)
            try {
                parsed_item = parseRule(item, def_ele, keyword, info)
                parsed_ok = true
            } catch (error) {
                if (!is_optional) throw error
                parsed_ok = false
            }
            if (parsed_ok == true) list_array.push(parsed_item)
        }
    }

    if (listOf) {
        const is_optional = optional.includes(lst_nb + 1)
        const def_ele = listOf

        let nb_of = 0
        for (; idx < nb_items; idx++) {
            item = tree.items[idx]
            parsed_item = parseRule(item, def_ele, keyword, info)
            list_array.push(parsed_item)
            nb_of++
        }

        if (nb_of == 0 && is_optional == false)
            throw SyntaxError(
                ` ListOf should contain at least one element ${_locate(
                    info,
                    tree.range,
                )}`,
            )
    } else if (tree.items[idx])
        throw SyntaxError(
            `To many elements in the list ${_locate(info, tree.range)}`,
        )

    return list_array
}

function _parseRuleOneOf(tree, rule_def, keyword, info) {
    let choices = rule_def['_oneOf']

    if (choices) {
        for (let choice of choices) {
            try {
                let res = parseRule(tree, choice, keyword, info)
                return res
            } catch (error) {}
        }
    }

    throw SyntaxError(
        `No option satisfied in oneOf ${_locate(
            info,
            tree.range,
        )} for keyword '${keyword}'`,
    )
}

function _parseRuleIn(tree, rule_def, keyword, info) {
    // fonctionne pour les scalaires uniquement, revoir pour les valeurs complexes
    if (rule_def['_in'].includes(tree.value)) {
        let str_res = _newString(tree)
        str_res.range = tree.range
        return str_res
    } else
        throw SyntaxError(
            `${tree.value} is not in  ${
                rule_def['_in']
            } for grammar keyword '${keyword} ${_locate(info, tree.range)}`,
        )
}

function _parseRuleNotIn(tree, rule_def, keyword, info) {
    // fonctionne pour les scalaires uniquement, revoir pour les valeurs complexes
    if (!rule_def['_notin'].includes(tree.value)) {
        let str_res = _newString(tree)
        str_res.range = tree.range
        return str_res
    } else
        throw SyntaxError(
            `${tree.value} should not be in ${
                rule_def['_notin']
            } for grammar keyword '${keyword} ${_locate(info, tree.range)}`,
        )
}

function _parseRuleRegExp(tree, rule_def, keyword, info) {
    let re_str = rule_def['_regexp']
    let str_res = new String('<missing>') as any
    if (typeof re_str === 'string') {
        let re = new RegExp(re_str)
        str_res = _newString(tree)
        let re_res = null
        if (str_res && (re_res = re.exec(str_res))) {
            str_res.range = tree.range
            str_res.parts = re_res.groups
            return str_res
        } else
            throw SyntaxError(
                `'${str_res}' does not match '${re_str}' for grammar keyword '${keyword}' ${_locate(
                    info,
                    tree.range,
                )}`,
            )
    } else
        throw SyntaxError(
            `'${str_res}' can not be used as a regular expression ( keyword '${keyword}' ) ${_locate(
                info,
                tree.range,
            )}`,
        )
}

function _dslObject(yamlObject, key_value, info) {
    let classname
    if (typeof key_value == 'string') classname = info.typed_rules[key_value]
    else throw SyntaxError(`'${key_value}' is not a key in the grammar`)

    if (classname)
        if (classname in info.classes) {
            let ret = new info.classes[classname](yamlObject, info)
            return ret
        } else throw SyntaxError(`'${classname}' is not a known class`)
    else {
        let ret = yamlObject
        return yamlObject
    }
}

// parsing
function parseRule(tree, rule_def, keyword, info) {
    if (typeof rule_def == 'string')
        return _parseAtomic(tree, rule_def, keyword, info)

    if (rule_def instanceof Object) {
        if ('_dict' in rule_def || '_dictOf' in rule_def)
            return _parseRuleMap(tree, rule_def, keyword, info)
        if ('_list' in rule_def || '_listOf' in rule_def)
            return _parseRuleList(tree, rule_def, keyword, info)
        if ('_oneOf' in rule_def)
            return _parseRuleOneOf(tree, rule_def, keyword, info)
        if ('_in' in rule_def)
            return _parseRuleIn(tree, rule_def, keyword, info)
        if ('_notin' in rule_def)
            return _parseRuleNotIn(tree, rule_def, keyword, info)
        if ('_regexp' in rule_def)
            return _parseRuleRegExp(tree, rule_def, keyword, info)
    }
}

function parseDsl(tree, info: Info, keyword) {
    let keyrule = info.dsl_tree[keyword]
    if (keyrule) {
        let yamlObject = parseRule(tree, keyrule, keyword, info)
        return _dslObject(yamlObject, keyword, info)
    } else
        throw SyntaxError(
            `Keyword '${keyword}' not found in language definition`,
        )
}

function getTextFromFile(file_path) {
    let txt
    try {
        txt = fs.readFileSync(file_path.toString(), 'utf8')
    } catch (e) {
        console.log(`can not read file : ${e}`)
    }

    return txt
}

export function parseYaml(src_txt, filename, document = false) {
    let src_content = filename ? getTextFromFile(filename) : src_txt

    let lcFinder = new LineColumn(src_content + '\n')
    let tree
    try {
        if (document === true) {
            let doc = yaml.parseDocument(src_content)
            tree = doc.contents
        } else {
            tree = yaml.parse(src_content)
        }
    } catch (e) {
        const deb: LineCol = lcFinder.fromIndex(e.source.range.start - 1)
        const fin: LineCol = lcFinder.fromIndex(e.source.range.end - 1)
        console.log(
            `${e.name}: ${e.message}\n\t at position ${deb}, ${fin} ${
                filename ? 'in file ' + filename : ' '
            }`,
        )
    }

    return { tree: tree, index: lcFinder }
}

function parseYamlDocument(src_txt, filename) {
    return parseYaml(src_txt, filename, true)
}

// parse DSL definition file
export function parse_dsl_def(info: Info, dsl_def_file) {
    let dsl_dir = path.resolve(path.dirname(dsl_def_file))
    let dsl = parseYaml(null, dsl_def_file)
    info.dsl_tree = {}
    info.typed_rules = {}

    for (const label in dsl.tree) {
        const [key, classname] = label.split('->')
        info.dsl_tree[key] = dsl.tree[label]
        info.typed_rules[key] = classname
    }

    if ('@import_classes' in info.dsl_tree) {
        try {
            var classes_path = `${dsl_dir}/${info.dsl_tree['@import_classes']}`
            info.classes = require(classes_path)
        } catch (e) {
            throw `Error : Can not load the DLS classes definition file ${classes_path}\n  ${e.name}: ${e.message}`
        }
    }

    return info
}

export function import_classes(info, classes_path) {
    try {
        info.classes = require(classes_path)
    } catch (e) {
        throw `Error : Can not load the DLS classes definition file ${classes_path}\n  ${e.name}: ${e.message}`
    }

    return info
}

// parse source file - step 1 : yaml parsing
export function parse_src_yaml(info: Info, src_file, src_txt = null) {
    let src = parseYamlDocument(src_txt, src_file)

    info.filename = src_file
    info.index = src.index
    info.src_tree = src.tree

    return info
}

// parse source_file - step 2 : dsl parsing
export function parse_src_dsl(info: Info, keyword) {
    info.nodes = parseDsl(info.src_tree, info, keyword)
    return info
}

function _parse(src_file, src_txt, dsl_def_file, keyword) {
    let info: Info = {} as any

    info = parse_dsl_def(info, dsl_def_file)

    info = parse_src_yaml(info, src_file, src_txt)

    info = parse_src_dsl(info, keyword)

    return info
}

// all in one parsing function giving source file and dsl definition file
export function parse_file(src_file, dsl_def_file, keyword) {
    return _parse(src_file, null, dsl_def_file, keyword)
}

// all in one parsing function giving source string and dsl definition file
export function parse_string(src_txt, dsl_def_file, keyword) {
    return _parse(null, src_txt, dsl_def_file, keyword)
}