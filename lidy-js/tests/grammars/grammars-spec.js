import { parse } from '../../parser/parse.js'

describe("Test real grammars ->", function() {

    it("check lidy's grammar",
        function() { expect( parse({src_file: "../../schema.lidy.yaml", dsl_file: '../../schema.lidy.yaml'}).success()).toEqual(true)})
})


